#define _DARWIN_C_SOURCE 1

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef O_NOFOLLOW_ANY
#error "zerox-safe-fs requires macOS O_NOFOLLOW_ANY support"
#endif

#define MAX_LOG_BYTES (4U * 1024U * 1024U)
#define TRANSACTION_DIRECTORY ".zerox-organize-transactions"
#define RECONCILIATION_SUFFIX ".reconciliation"
#define RECONCILIATION_BODY \
  "{\"schemaVersion\":1,\"kind\":\"local-file-organization-reconciliation-required\"}\n"

typedef struct {
  dev_t dev;
  ino_t ino;
  off_t size;
  uid_t uid;
} file_identity;

static int fail_message(const char *message) {
  fprintf(stderr, "zerox-safe-fs: %s\n", message);
  return 1;
}

static int fail_errno(const char *message) {
  fprintf(stderr, "zerox-safe-fs: %s: %s\n", message, strerror(errno));
  return 1;
}

static int is_single_component(const char *value) {
  size_t length;
  if (value == NULL || value[0] == '\0') return 0;
  length = strlen(value);
  if (length > NAME_MAX || strchr(value, '/') != NULL) return 0;
  return strcmp(value, ".") != 0 && strcmp(value, "..") != 0;
}

static int is_category(const char *value) {
  static const char *categories[] = {
    "Images", "Documents", "Archives", "Audio", "Video", "Code",
    "Spreadsheets", "Presentations", "Other",
  };
  size_t index;
  for (index = 0; index < sizeof(categories) / sizeof(categories[0]); index += 1) {
    if (strcmp(value, categories[index]) == 0) return 1;
  }
  return 0;
}

static int parse_u64(const char *value, uint64_t *result) {
  char *end = NULL;
  unsigned long long parsed;
  if (value == NULL || value[0] == '\0' || value[0] == '-') return 0;
  errno = 0;
  parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0') return 0;
  *result = (uint64_t)parsed;
  return 1;
}

static int parse_identity(
  const char *dev_value,
  const char *ino_value,
  const char *size_value,
  const char *uid_value,
  file_identity *identity
) {
  uint64_t dev;
  uint64_t ino;
  uint64_t size;
  uint64_t uid;
  if (
    !parse_u64(dev_value, &dev) ||
    !parse_u64(ino_value, &ino) ||
    !parse_u64(size_value, &size) ||
    !parse_u64(uid_value, &uid)
  ) {
    return 0;
  }
  identity->dev = (dev_t)dev;
  identity->ino = (ino_t)ino;
  identity->size = (off_t)size;
  identity->uid = (uid_t)uid;
  return
    (uint64_t)identity->dev == dev &&
    (uint64_t)identity->ino == ino &&
    (uint64_t)identity->size == size &&
    (uint64_t)identity->uid == uid;
}

static int stat_matches(const struct stat *stats, const file_identity *identity) {
  return
    stats->st_dev == identity->dev &&
    stats->st_ino == identity->ino &&
    stats->st_size == identity->size &&
    stats->st_uid == identity->uid;
}

static int read_regular_at(
  int directory_fd,
  const char *name,
  const file_identity *expected,
  struct stat *stats
) {
  if (fstatat(directory_fd, name, stats, AT_SYMLINK_NOFOLLOW) != 0) {
    return fail_errno("cannot inspect regular file");
  }
  if (!S_ISREG(stats->st_mode)) {
    return fail_message("path is not a regular file");
  }
  if (expected != NULL && !stat_matches(stats, expected)) {
    return fail_message("regular-file identity changed");
  }
  return 0;
}

static int verify_fd_path(int fd, const char *expected_path) {
  char actual_path[MAXPATHLEN];
  if (fcntl(fd, F_GETPATH, actual_path) != 0) {
    return fail_errno("cannot resolve opened directory capability");
  }
  if (strcmp(actual_path, expected_path) != 0) {
    return fail_message("opened directory capability moved from its authorized path");
  }
  return 0;
}

static int open_root(
  const char *root_path,
  const file_identity *expected,
  int *root_fd
) {
  struct stat stats;
  if (root_path == NULL || root_path[0] != '/') {
    return fail_message("root must be an absolute path");
  }
  *root_fd = open(
    root_path,
    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW_ANY
  );
  if (*root_fd < 0) return fail_errno("cannot open authorized root");
  if (fstat(*root_fd, &stats) != 0) return fail_errno("cannot inspect authorized root");
  if (
    !S_ISDIR(stats.st_mode) ||
    stats.st_dev != expected->dev ||
    stats.st_ino != expected->ino ||
    stats.st_uid != expected->uid
  ) {
    return fail_message("authorized root identity changed");
  }
  return verify_fd_path(*root_fd, root_path);
}

static int open_child_directory(
  int root_fd,
  const char *root_path,
  const char *name,
  int allow_create,
  int *child_fd,
  char expected_path[MAXPATHLEN]
) {
  struct stat root_stats;
  struct stat child_stats;
  int written;
  if (!is_single_component(name)) {
    return fail_message("child directory is not a single path component");
  }
  if (allow_create && mkdirat(root_fd, name, 0700) != 0 && errno != EEXIST) {
    return fail_errno("cannot create authorized child directory");
  }
  *child_fd = openat(
    root_fd,
    name,
    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
  );
  if (*child_fd < 0) return fail_errno("cannot open authorized child directory");
  if (fstat(root_fd, &root_stats) != 0 || fstat(*child_fd, &child_stats) != 0) {
    return fail_errno("cannot inspect authorized child directory");
  }
  if (!S_ISDIR(child_stats.st_mode) || child_stats.st_uid != root_stats.st_uid) {
    return fail_message("authorized child directory ownership changed");
  }
  written = snprintf(expected_path, MAXPATHLEN, "%s/%s", root_path, name);
  if (written < 0 || written >= MAXPATHLEN) {
    return fail_message("authorized child directory path is too long");
  }
  return verify_fd_path(*child_fd, expected_path);
}

static int test_stage_selected(const char *stage) {
  const char *configured = getenv("ZEROX_SAFE_FS_TEST_READY_STAGE");
  return configured == NULL
    ? strcmp(stage, "directories-opened") == 0
    : strcmp(configured, stage) == 0;
}

static void maybe_test_checkpoint(const char *stage) {
  const char *value = getenv("ZEROX_SAFE_FS_TEST_DELAY_MS");
  uint64_t delay_ms = 0;
  const char *ready = getenv("ZEROX_SAFE_FS_TEST_READY");
  if (!test_stage_selected(stage)) return;
  if (ready != NULL && strcmp(ready, "1") == 0) {
    fprintf(stderr, "zerox-safe-fs-test-ready:%s\n", stage);
    fflush(stderr);
  }
  if (
    value != NULL
    && parse_u64(value, &delay_ms)
    && delay_ms <= 5000U
    && delay_ms > 0U
  ) {
    usleep((useconds_t)(delay_ms * 1000U));
  }
}

static int verify_directories(
  int root_fd,
  const char *root_path,
  int child_fd,
  const char *child_path
) {
  int result = verify_fd_path(root_fd, root_path);
  if (result != 0) return result;
  return verify_fd_path(child_fd, child_path);
}

static int verify_opened_regular_path(
  int directory_fd,
  const char *directory_path,
  const char *name,
  int file_fd,
  const file_identity *expected
) {
  char expected_path[MAXPATHLEN];
  struct stat directory_stats;
  struct stat opened_stats;
  struct stat path_stats;
  int written = snprintf(
    expected_path,
    sizeof(expected_path),
    "%s/%s",
    directory_path,
    name
  );
  if (written < 0 || (size_t)written >= sizeof(expected_path)) {
    return fail_message("opened regular-file path is too long");
  }
  if (
    fstat(directory_fd, &directory_stats) != 0
    || fstat(file_fd, &opened_stats) != 0
  ) {
    return fail_errno("cannot inspect opened regular file");
  }
  if (
    !S_ISDIR(directory_stats.st_mode)
    || !S_ISREG(opened_stats.st_mode)
    || opened_stats.st_nlink != 1
    || (opened_stats.st_mode & 0777) != 0600
    || opened_stats.st_uid != directory_stats.st_uid
    || !stat_matches(&opened_stats, expected)
  ) {
    return fail_message("opened regular-file identity changed");
  }
  if (read_regular_at(directory_fd, name, expected, &path_stats) != 0) return 1;
  if (
    path_stats.st_nlink != 1
    || path_stats.st_dev != opened_stats.st_dev
    || path_stats.st_ino != opened_stats.st_ino
  ) {
    return fail_message("regular-file path no longer names the opened file");
  }
  return verify_fd_path(file_fd, expected_path);
}

static int verify_move_authority(
  int root_fd,
  const char *root_path,
  int category_fd,
  const char *category_path,
  int log_fd,
  const char *log_path,
  int journal_fd,
  const char *journal_name,
  const file_identity *journal_identity
) {
  int result = verify_directories(root_fd, root_path, category_fd, category_path);
  if (result != 0) return result;
  result = verify_fd_path(log_fd, log_path);
  if (result != 0) return result;
  return verify_opened_regular_path(
    log_fd,
    log_path,
    journal_name,
    journal_fd,
    journal_identity
  );
}

static int validate_reconciliation_marker(
  int log_fd,
  const char *marker_name,
  int marker_fd
) {
  char log_path[MAXPATHLEN];
  char marker_path[MAXPATHLEN];
  char expected_marker_path[MAXPATHLEN];
  char body[sizeof(RECONCILIATION_BODY)];
  struct stat log_stats;
  struct stat before;
  struct stat after;
  struct stat leaf;
  ssize_t count;
  int written;
  if (
    fcntl(log_fd, F_GETPATH, log_path) != 0
    || fcntl(marker_fd, F_GETPATH, marker_path) != 0
  ) {
    return fail_errno("cannot resolve reconciliation marker capability");
  }
  written = snprintf(
    expected_marker_path,
    sizeof(expected_marker_path),
    "%s/%s",
    log_path,
    marker_name
  );
  if (written < 0 || (size_t)written >= sizeof(expected_marker_path)) {
    return fail_message("reconciliation marker path is too long");
  }
  if (
    strcmp(marker_path, expected_marker_path) != 0
    || fstat(log_fd, &log_stats) != 0
    || fstat(marker_fd, &before) != 0
    || fstatat(log_fd, marker_name, &leaf, AT_SYMLINK_NOFOLLOW) != 0
  ) {
    return fail_message("reconciliation marker capability is not canonical");
  }
  if (
    !S_ISDIR(log_stats.st_mode)
    || !S_ISREG(before.st_mode)
    || before.st_nlink != 1
    || (before.st_mode & 0777) != 0600
    || before.st_uid != log_stats.st_uid
    || !S_ISREG(leaf.st_mode)
    || leaf.st_nlink != 1
    || leaf.st_dev != before.st_dev
    || leaf.st_ino != before.st_ino
    || leaf.st_size != before.st_size
  ) {
    return fail_message("reconciliation marker metadata is invalid");
  }
  count = pread(marker_fd, body, sizeof(body), 0);
  if (
    count != (ssize_t)(sizeof(RECONCILIATION_BODY) - 1U)
    || memcmp(
      body,
      RECONCILIATION_BODY,
      sizeof(RECONCILIATION_BODY) - 1U
    ) != 0
  ) {
    return fail_message("reconciliation marker body is invalid");
  }
  if (fstat(marker_fd, &after) != 0) {
    return fail_errno("cannot re-inspect reconciliation marker");
  }
  if (
    after.st_dev != before.st_dev
    || after.st_ino != before.st_ino
    || after.st_size != before.st_size
    || after.st_nlink != before.st_nlink
    || after.st_uid != before.st_uid
    || after.st_mtimespec.tv_sec != before.st_mtimespec.tv_sec
    || after.st_mtimespec.tv_nsec != before.st_mtimespec.tv_nsec
    || after.st_ctimespec.tv_sec != before.st_ctimespec.tv_sec
    || after.st_ctimespec.tv_nsec != before.st_ctimespec.tv_nsec
  ) {
    return fail_message("reconciliation marker changed while reading");
  }
  return 0;
}

static int record_reconciliation_marker(
  int log_fd,
  const char *transaction_id
) {
  char marker_name[NAME_MAX + 1];
  const char *body = RECONCILIATION_BODY;
  size_t body_length = strlen(body);
  size_t offset = 0U;
  int marker_fd;
  int written = snprintf(
    marker_name,
    sizeof(marker_name),
    "%s%s",
    transaction_id,
    RECONCILIATION_SUFFIX
  );
  if (written < 0 || (size_t)written >= sizeof(marker_name)) {
    return fail_message("reconciliation marker name is too long");
  }
  marker_fd = openat(
    log_fd,
    marker_name,
    O_RDWR | O_CLOEXEC | O_NOFOLLOW | O_CREAT | O_EXCL,
    0600
  );
  if (marker_fd < 0 && errno == EEXIST) {
    marker_fd = openat(log_fd, marker_name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (marker_fd < 0) {
      return fail_errno("cannot open existing reconciliation marker");
    }
    if (validate_reconciliation_marker(log_fd, marker_name, marker_fd) != 0) {
      close(marker_fd);
      return fail_message("existing reconciliation marker is invalid");
    }
    if (close(marker_fd) != 0) {
      return fail_errno("cannot close existing reconciliation marker");
    }
    return fsync(log_fd) == 0
      ? 0
      : fail_errno("cannot synchronize reconciliation directory");
  }
  if (marker_fd < 0) return fail_errno("cannot create reconciliation marker");
  while (offset < body_length) {
    ssize_t count = write(marker_fd, body + offset, body_length - offset);
    if (count < 0) {
      if (errno == EINTR) continue;
      close(marker_fd);
      return fail_errno("cannot write reconciliation marker");
    }
    offset += (size_t)count;
  }
  if (fsync(marker_fd) != 0) {
    close(marker_fd);
    return fail_errno("cannot synchronize reconciliation marker");
  }
  if (validate_reconciliation_marker(log_fd, marker_name, marker_fd) != 0) {
    close(marker_fd);
    return fail_message("new reconciliation marker failed self-validation");
  }
  if (close(marker_fd) != 0) {
    return fail_errno("cannot close reconciliation marker");
  }
  return fsync(log_fd) == 0
    ? 0
    : fail_errno("cannot synchronize reconciliation directory");
}

static int restore_moved_entry(
  int source_fd,
  const char *source_name,
  int target_fd,
  const char *target_name,
  const struct stat *moved_stats
) {
  struct stat current_target;
  struct stat restored_source;
  if (fstatat(target_fd, target_name, &current_target, AT_SYMLINK_NOFOLLOW) != 0) {
    return 1;
  }
  if (
    !S_ISREG(current_target.st_mode)
    || current_target.st_dev != moved_stats->st_dev
    || current_target.st_ino != moved_stats->st_ino
  ) {
    return 1;
  }
  if (
    renameatx_np(
      target_fd,
      target_name,
      source_fd,
      source_name,
      RENAME_EXCL
    ) != 0
  ) {
    return 1;
  }
  if (
    fstatat(source_fd, source_name, &restored_source, AT_SYMLINK_NOFOLLOW) != 0
    || !S_ISREG(restored_source.st_mode)
    || restored_source.st_dev != moved_stats->st_dev
    || restored_source.st_ino != moved_stats->st_ino
  ) {
    return 1;
  }
  if (fstatat(target_fd, target_name, &current_target, AT_SYMLINK_NOFOLLOW) == 0) {
    return 1;
  }
  if (errno != ENOENT) return 1;
  return fsync(source_fd) == 0 && fsync(target_fd) == 0 ? 0 : 1;
}

static int move_between_directories(
  int source_fd,
  const char *source_name,
  int target_fd,
  const char *target_name,
  const file_identity *expected,
  int root_fd,
  const char *root_path,
  int category_fd,
  const char *category_path,
  int log_fd,
  const char *log_path,
  int journal_fd,
  const char *journal_name,
  const file_identity *journal_identity,
  const char *transaction_id
) {
  struct stat source_stats;
  struct stat moved_stats;
  struct stat post_stats;
  int result = read_regular_at(source_fd, source_name, expected, &source_stats);
  if (result != 0) return result;
  maybe_test_checkpoint("source-verified");
  result = verify_move_authority(
    root_fd,
    root_path,
    category_fd,
    category_path,
    log_fd,
    log_path,
    journal_fd,
    journal_name,
    journal_identity
  );
  if (result != 0) return result;
  result = read_regular_at(source_fd, source_name, expected, &source_stats);
  if (result != 0) return result;
  if (
    renameatx_np(
      source_fd,
      source_name,
      target_fd,
      target_name,
      RENAME_EXCL
    ) != 0
  ) {
    if (errno == EEXIST) return fail_message("target appeared after preview");
    return fail_errno("cannot atomically move to no-replace target");
  }
  if (fstatat(target_fd, target_name, &moved_stats, AT_SYMLINK_NOFOLLOW) != 0) {
    if (record_reconciliation_marker(log_fd, transaction_id) != 0) {
      return fail_message(
        "cannot observe atomically moved target and reconciliation marker could not be persisted"
      );
    }
    return fail_message(
      "cannot observe atomically moved target; reconciliation marker persisted"
    );
  }
  maybe_test_checkpoint("move-applied");
  result = verify_move_authority(
    root_fd,
    root_path,
    category_fd,
    category_path,
    log_fd,
    log_path,
    journal_fd,
    journal_name,
    journal_identity
  );
  if (
    result == 0
    && (
      !S_ISREG(moved_stats.st_mode)
      || !stat_matches(&moved_stats, expected)
      || moved_stats.st_dev != source_stats.st_dev
      || moved_stats.st_ino != source_stats.st_ino
    )
  ) {
    result = fail_message("atomically moved target identity is inconsistent");
  }
  if (
    result == 0
    && fstatat(target_fd, target_name, &post_stats, AT_SYMLINK_NOFOLLOW) != 0
  ) {
    result = fail_errno("cannot verify atomically moved target");
  }
  if (
    result == 0
    && (
      !S_ISREG(post_stats.st_mode)
      || post_stats.st_dev != moved_stats.st_dev
      || post_stats.st_ino != moved_stats.st_ino
    )
  ) {
    result = fail_message("atomically moved target changed after rename");
  }
  if (
    result == 0
    && fstatat(source_fd, source_name, &post_stats, AT_SYMLINK_NOFOLLOW) == 0
  ) {
    result = fail_message("source path was repopulated during atomic move");
  }
  if (result == 0 && errno != ENOENT) {
    result = fail_errno("cannot verify atomic source retirement");
  }
  if (result == 0 && (fsync(source_fd) != 0 || fsync(target_fd) != 0)) {
    result = fail_errno("cannot durably synchronize moved file");
  }
  if (result == 0) return 0;
  if (
    restore_moved_entry(
      source_fd,
      source_name,
      target_fd,
      target_name,
      &moved_stats
    ) == 0
  ) {
    return fail_message("move postcondition failed; original layout restored");
  }
  if (record_reconciliation_marker(log_fd, transaction_id) != 0) {
    return fail_message(
      "move postcondition failed and reconciliation marker could not be persisted"
    );
  }
  return fail_message("move postcondition failed; reconciliation marker persisted");
}

static int run_move(int argc, char **argv, int reverse) {
  file_identity root_identity;
  file_identity source_identity;
  file_identity journal_identity;
  int root_fd = -1;
  int category_fd = -1;
  int log_fd = -1;
  int journal_fd = -1;
  int result;
  char category_path[MAXPATHLEN];
  char log_path[MAXPATHLEN];
  char journal_name[NAME_MAX + 1];
  int written;
  if (argc != 18) return fail_message("invalid move arguments");
  if (!is_single_component(argv[7]) || !is_category(argv[8]) || !is_single_component(argv[9])) {
    return fail_message("move paths must use allowed single components");
  }
  if (!is_single_component(argv[13])) {
    return fail_message("invalid move transaction id");
  }
  if (!parse_identity(argv[3], argv[4], "0", argv[5], &root_identity)) {
    return fail_message("invalid root identity");
  }
  if (!parse_identity(argv[10], argv[11], argv[12], argv[6], &source_identity)) {
    return fail_message("invalid source identity");
  }
  if (!parse_identity(argv[14], argv[15], argv[16], argv[17], &journal_identity)) {
    return fail_message("invalid journal identity");
  }
  written = snprintf(journal_name, sizeof(journal_name), "%s.json", argv[13]);
  if (written < 0 || (size_t)written >= sizeof(journal_name)) {
    return fail_message("transaction journal name is too long");
  }
  result = open_root(argv[2], &root_identity, &root_fd);
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd,
    argv[2],
    argv[8],
    reverse ? 0 : 1,
    &category_fd,
    category_path
  );
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd,
    argv[2],
    TRANSACTION_DIRECTORY,
    0,
    &log_fd,
    log_path
  );
  if (result != 0) goto done;
  journal_fd = openat(log_fd, journal_name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (journal_fd < 0) {
    result = fail_errno("cannot open transaction journal authority");
    goto done;
  }
  result = verify_opened_regular_path(
    log_fd,
    log_path,
    journal_name,
    journal_fd,
    &journal_identity
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("journal-bound");
  maybe_test_checkpoint("directories-opened");
  result = verify_move_authority(
    root_fd,
    argv[2],
    category_fd,
    category_path,
    log_fd,
    log_path,
    journal_fd,
    journal_name,
    &journal_identity
  );
  if (result != 0) goto done;
  result = reverse
    ? move_between_directories(
        category_fd,
        argv[7],
        root_fd,
        argv[9],
        &source_identity,
        root_fd,
        argv[2],
        category_fd,
        category_path,
        log_fd,
        log_path,
        journal_fd,
        journal_name,
        &journal_identity,
        argv[13]
      )
    : move_between_directories(
        root_fd,
        argv[7],
        category_fd,
        argv[9],
        &source_identity,
        root_fd,
        argv[2],
        category_fd,
        category_path,
        log_fd,
        log_path,
        journal_fd,
        journal_name,
        &journal_identity,
        argv[13]
      );
done:
  if (journal_fd >= 0) close(journal_fd);
  if (log_fd >= 0) close(log_fd);
  if (category_fd >= 0) close(category_fd);
  if (root_fd >= 0) close(root_fd);
  if (result == 0) puts("{\"ok\":true}");
  return result;
}

static int read_stdin_body(char **body, size_t *length) {
  size_t capacity = 4096U;
  size_t used = 0U;
  ssize_t count;
  char *buffer = malloc(capacity);
  if (buffer == NULL) return fail_errno("cannot allocate log buffer");
  while (1) {
    if (used == capacity) {
      char *resized;
      if (capacity >= MAX_LOG_BYTES) {
        free(buffer);
        return fail_message("transaction log exceeds the safe size limit");
      }
      capacity *= 2U;
      if (capacity > MAX_LOG_BYTES) capacity = MAX_LOG_BYTES;
      resized = realloc(buffer, capacity);
      if (resized == NULL) {
        free(buffer);
        return fail_errno("cannot grow log buffer");
      }
      buffer = resized;
    }
    count = read(STDIN_FILENO, buffer + used, capacity - used);
    if (count < 0) {
      if (errno == EINTR) continue;
      free(buffer);
      return fail_errno("cannot read transaction log input");
    }
    if (count == 0) break;
    used += (size_t)count;
  }
  *body = buffer;
  *length = used;
  return 0;
}

static int write_all(int fd, const char *body, size_t length) {
  size_t offset = 0U;
  while (offset < length) {
    ssize_t written = write(fd, body + offset, length - offset);
    if (written < 0) {
      if (errno == EINTR) continue;
      return fail_errno("cannot write transaction log");
    }
    offset += (size_t)written;
  }
  return 0;
}

static void print_identity(const struct stat *stats) {
  printf(
    "{\"ok\":true,\"identity\":{\"dev\":\"%llu\",\"ino\":\"%llu\","
    "\"size\":\"%llu\",\"uid\":\"%llu\"}}\n",
    (unsigned long long)stats->st_dev,
    (unsigned long long)stats->st_ino,
    (unsigned long long)stats->st_size,
    (unsigned long long)stats->st_uid
  );
}

static int run_log(int argc, char **argv, int append) {
  file_identity root_identity;
  file_identity expected_log;
  struct stat opened_stats;
  struct stat path_stats;
  struct stat final_stats;
  int root_fd = -1;
  int log_fd = -1;
  int output_fd = -1;
  int result = 0;
  int saved_errno;
  int mutation_started = 0;
  char log_path[MAXPATHLEN];
  char final_name[NAME_MAX + 1];
  char *body = NULL;
  size_t body_length = 0U;
  int written;
  if (argc != (append ? 11 : 7)) return fail_message("invalid log arguments");
  if (!is_single_component(argv[6])) return fail_message("invalid transaction id");
  if (!parse_identity(argv[3], argv[4], "0", argv[5], &root_identity)) {
    return fail_message("invalid root identity");
  }
  if (
    append &&
    !parse_identity(argv[7], argv[8], argv[9], argv[10], &expected_log)
  ) {
    return fail_message("invalid existing log identity");
  }
  written = snprintf(final_name, sizeof(final_name), "%s.json", argv[6]);
  if (written < 0 || (size_t)written >= sizeof(final_name)) {
    return fail_message("transaction log name is too long");
  }
  result = read_stdin_body(&body, &body_length);
  if (result != 0) goto done;
  result = open_root(argv[2], &root_identity, &root_fd);
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd,
    argv[2],
    TRANSACTION_DIRECTORY,
    1,
    &log_fd,
    log_path
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("directories-opened");
  result = verify_directories(root_fd, argv[2], log_fd, log_path);
  if (result != 0) goto done;
  maybe_test_checkpoint("log-before-mutation");
  result = verify_directories(root_fd, argv[2], log_fd, log_path);
  if (result != 0) goto done;
  output_fd = openat(
    log_fd,
    final_name,
    O_WRONLY | O_CLOEXEC | O_NOFOLLOW |
      (append ? O_APPEND : O_CREAT | O_EXCL),
    0600
  );
  if (output_fd < 0) {
    result = fail_errno(append
      ? "cannot open transaction log for append"
      : "cannot create transaction log");
    goto done;
  }
  if (!append) mutation_started = 1;
  if (fstat(output_fd, &opened_stats) != 0) {
    result = fail_errno("cannot inspect opened transaction log");
    goto done;
  }
  if (
    !S_ISREG(opened_stats.st_mode)
    || opened_stats.st_nlink != 1
    || (append && !stat_matches(&opened_stats, &expected_log))
  ) {
    result = fail_message("opened transaction log identity changed");
    goto done;
  }
  maybe_test_checkpoint("log-opened");
  result = verify_directories(root_fd, argv[2], log_fd, log_path);
  if (result != 0) goto done;
  result = read_regular_at(
    log_fd,
    final_name,
    append ? &expected_log : NULL,
    &path_stats
  );
  if (result != 0) goto done;
  if (
    path_stats.st_dev != opened_stats.st_dev
    || path_stats.st_ino != opened_stats.st_ino
  ) {
    result = fail_message("transaction log path no longer names the opened file");
    goto done;
  }
  mutation_started = 1;
  result = write_all(output_fd, body, body_length);
  if (result != 0 || fsync(output_fd) != 0) {
    if (result == 0) result = fail_errno("cannot synchronize transaction log");
    goto done;
  }
  if (fstat(output_fd, &final_stats) != 0) {
    result = fail_errno("cannot inspect written transaction log");
    goto done;
  }
  maybe_test_checkpoint("log-mutated");
  result = verify_directories(root_fd, argv[2], log_fd, log_path);
  if (result != 0) goto done;
  result = read_regular_at(log_fd, final_name, NULL, &path_stats);
  if (result != 0) goto done;
  if (
    path_stats.st_dev != final_stats.st_dev ||
    path_stats.st_ino != final_stats.st_ino ||
    path_stats.st_size != final_stats.st_size ||
    path_stats.st_uid != final_stats.st_uid ||
    path_stats.st_nlink != 1
  ) {
    result = fail_message("transaction log path changed during append");
    goto done;
  }
  if (close(output_fd) != 0) {
    output_fd = -1;
    result = fail_errno("cannot close transaction log");
    goto done;
  }
  output_fd = -1;
  if (fsync(log_fd) != 0 || fsync(root_fd) != 0) {
    result = fail_errno("cannot synchronize transaction directory");
    goto done;
  }
  result = verify_directories(root_fd, argv[2], log_fd, log_path);
  if (result != 0) goto done;
  print_identity(&final_stats);
done:
  saved_errno = errno;
  if (result != 0 && mutation_started && log_fd >= 0) {
    if (record_reconciliation_marker(log_fd, argv[6]) != 0) {
      (void)fail_message(
        "transaction journal mutated but reconciliation marker could not be persisted"
      );
    }
  }
  if (output_fd >= 0) close(output_fd);
  if (log_fd >= 0) close(log_fd);
  if (root_fd >= 0) close(root_fd);
  free(body);
  errno = saved_errno;
  return result;
}

int main(int argc, char **argv) {
  if (argc < 2) return fail_message("missing command");
  if (strcmp(argv[1], "move-into-category") == 0) {
    return run_move(argc, argv, 0);
  }
  if (strcmp(argv[1], "move-from-category") == 0) {
    return run_move(argc, argv, 1);
  }
  if (strcmp(argv[1], "log-create") == 0) {
    return run_log(argc, argv, 0);
  }
  if (strcmp(argv[1], "log-append") == 0) {
    return run_log(argc, argv, 1);
  }
  return fail_message("unknown command");
}
