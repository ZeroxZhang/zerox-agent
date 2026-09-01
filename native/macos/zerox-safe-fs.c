#define _DARWIN_C_SOURCE 1

#include <errno.h>
#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef O_NOFOLLOW_ANY
#error "zerox-safe-fs requires macOS O_NOFOLLOW_ANY support"
#endif

#define MAX_LOG_BYTES (4U * 1024U * 1024U)
#define TRANSACTION_DIRECTORY ".zerox-organize-transactions"
#define ZEROX_DIRECTORY ".zerox"
#define PLAN_DIRECTORY "plans"
#define RECONCILIATION_SUFFIX ".reconciliation"
#define RECONCILIATION_BODY \
  "{\"schemaVersion\":1,\"kind\":\"local-file-organization-reconciliation-required\"}\n"

typedef struct {
  dev_t dev;
  ino_t ino;
  off_t size;
  uid_t uid;
  char sha256[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
} file_identity;

typedef struct {
  dev_t dev;
  ino_t ino;
  uid_t uid;
  mode_t mode;
} directory_identity;

static void maybe_test_checkpoint(const char *stage);

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

static int parse_file_identity(
  const char *dev_value,
  const char *ino_value,
  const char *size_value,
  const char *uid_value,
  const char *sha256_value,
  file_identity *identity
) {
  uint64_t dev;
  uint64_t ino;
  uint64_t size;
  uint64_t uid;
  size_t digest_index;
  if (
    !parse_u64(dev_value, &dev) ||
    !parse_u64(ino_value, &ino) ||
    !parse_u64(size_value, &size) ||
    !parse_u64(uid_value, &uid)
  ) {
    return 0;
  }
  if (
    sha256_value == NULL
    || strncmp(sha256_value, "sha256:", 7U) != 0
    || strlen(sha256_value + 7U) != CC_SHA256_DIGEST_LENGTH * 2U
  ) {
    return 0;
  }
  for (
    digest_index = 0U;
    digest_index < CC_SHA256_DIGEST_LENGTH * 2U;
    digest_index += 1U
  ) {
    const char value = sha256_value[7U + digest_index];
    if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))) {
      return 0;
    }
  }
  identity->dev = (dev_t)dev;
  identity->ino = (ino_t)ino;
  identity->size = (off_t)size;
  identity->uid = (uid_t)uid;
  memcpy(identity->sha256, sha256_value + 7U, sizeof(identity->sha256));
  return
    (uint64_t)identity->dev == dev &&
    (uint64_t)identity->ino == ino &&
    (uint64_t)identity->size == size &&
    (uint64_t)identity->uid == uid;
}

static int parse_sha256_value(
  const char *value,
  char digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U]
) {
  size_t index;
  if (
    value == NULL
    || strncmp(value, "sha256:", 7U) != 0
    || strlen(value + 7U) != CC_SHA256_DIGEST_LENGTH * 2U
  ) {
    return 0;
  }
  for (index = 0U; index < CC_SHA256_DIGEST_LENGTH * 2U; index += 1U) {
    const char character = value[7U + index];
    if (!(
      (character >= '0' && character <= '9')
      || (character >= 'a' && character <= 'f')
    )) {
      return 0;
    }
  }
  memcpy(digest, value + 7U, CC_SHA256_DIGEST_LENGTH * 2U);
  digest[CC_SHA256_DIGEST_LENGTH * 2U] = '\0';
  return 1;
}

static int parse_directory_identity(
  const char *dev_value,
  const char *ino_value,
  const char *uid_value,
  const char *mode_value,
  directory_identity *identity
) {
  uint64_t dev;
  uint64_t ino;
  uint64_t uid;
  uint64_t mode;
  if (
    !parse_u64(dev_value, &dev)
    || !parse_u64(ino_value, &ino)
    || !parse_u64(uid_value, &uid)
    || !parse_u64(mode_value, &mode)
    || mode > 0777U
  ) {
    return 0;
  }
  identity->dev = (dev_t)dev;
  identity->ino = (ino_t)ino;
  identity->uid = (uid_t)uid;
  identity->mode = (mode_t)mode;
  return
    (uint64_t)identity->dev == dev
    && (uint64_t)identity->ino == ino
    && (uint64_t)identity->uid == uid
    && (uint64_t)identity->mode == mode;
}

static int stat_matches(const struct stat *stats, const file_identity *identity) {
  return
    stats->st_dev == identity->dev &&
    stats->st_ino == identity->ino &&
    stats->st_size == identity->size &&
    stats->st_uid == identity->uid;
}

static int stat_snapshot_matches(
  const struct stat *before,
  const struct stat *after
) {
  return
    before->st_dev == after->st_dev
    && before->st_ino == after->st_ino
    && before->st_size == after->st_size
    && before->st_uid == after->st_uid
    && before->st_mode == after->st_mode
    && before->st_nlink == after->st_nlink
    && before->st_mtimespec.tv_sec == after->st_mtimespec.tv_sec
    && before->st_mtimespec.tv_nsec == after->st_mtimespec.tv_nsec
    && before->st_ctimespec.tv_sec == after->st_ctimespec.tv_sec
    && before->st_ctimespec.tv_nsec == after->st_ctimespec.tv_nsec;
}

static int safe_directory_mode(mode_t mode) {
  return (mode & 0022) == 0;
}

static int sha256_fd_with_checkpoint(
  int fd,
  char output[CC_SHA256_DIGEST_LENGTH * 2U + 1U],
  const char *checkpoint
) {
  CC_SHA256_CTX context;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  unsigned char buffer[64U * 1024U];
  struct stat before;
  struct stat after;
  off_t offset = 0;
  ssize_t count;
  size_t index;
  int checkpoint_emitted = 0;
  if (fstat(fd, &before) != 0) {
    return fail_errno("cannot inspect regular file before digest");
  }
  if (!S_ISREG(before.st_mode)) {
    return fail_message("digest source is not a regular file");
  }
  if (CC_SHA256_Init(&context) != 1) {
    return fail_message("cannot initialize regular-file digest");
  }
  while (1) {
    count = pread(fd, buffer, sizeof(buffer), offset);
    if (count < 0) {
      if (errno == EINTR) continue;
      return fail_errno("cannot read regular file for digest");
    }
    if (count == 0) break;
    if (CC_SHA256_Update(&context, buffer, (CC_LONG)count) != 1) {
      return fail_message("cannot update regular-file digest");
    }
    offset += count;
    if (!checkpoint_emitted && checkpoint != NULL) {
      checkpoint_emitted = 1;
      maybe_test_checkpoint(checkpoint);
    }
  }
  if (CC_SHA256_Final(digest, &context) != 1) {
    return fail_message("cannot finalize regular-file digest");
  }
  for (index = 0U; index < CC_SHA256_DIGEST_LENGTH; index += 1U) {
    (void)snprintf(output + index * 2U, 3U, "%02x", digest[index]);
  }
  output[CC_SHA256_DIGEST_LENGTH * 2U] = '\0';
  if (fstat(fd, &after) != 0) {
    return fail_errno("cannot inspect regular file after digest");
  }
  if (!stat_snapshot_matches(&before, &after)) {
    return fail_message("regular-file identity changed during digest");
  }
  return 0;
}

static int sha256_fd(int fd, char output[CC_SHA256_DIGEST_LENGTH * 2U + 1U]) {
  return sha256_fd_with_checkpoint(fd, output, NULL);
}

static int sha256_bytes(
  const char *bytes,
  size_t length,
  char output[CC_SHA256_DIGEST_LENGTH * 2U + 1U]
) {
  CC_SHA256_CTX context;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  size_t index;
  if (length > UINT32_MAX) return fail_message("projection body is too large");
  if (
    CC_SHA256_Init(&context) != 1
    || CC_SHA256_Update(&context, bytes, (CC_LONG)length) != 1
    || CC_SHA256_Final(digest, &context) != 1
  ) {
    return fail_message("cannot calculate projection body digest");
  }
  for (index = 0U; index < CC_SHA256_DIGEST_LENGTH; index += 1U) {
    (void)snprintf(output + index * 2U, 3U, "%02x", digest[index]);
  }
  output[CC_SHA256_DIGEST_LENGTH * 2U] = '\0';
  return 0;
}

static int digest_matches_with_checkpoint(
  int fd,
  const file_identity *identity,
  const char *checkpoint
) {
  char digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
  if (sha256_fd_with_checkpoint(fd, digest, checkpoint) != 0) return 0;
  if (strcmp(digest, identity->sha256) != 0) {
    (void)fail_message("regular-file content digest changed");
    return 0;
  }
  return 1;
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
  const directory_identity *expected,
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
    stats.st_uid != expected->uid ||
    (stats.st_mode & 0777) != expected->mode ||
    !safe_directory_mode(stats.st_mode)
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
  char expected_path[MAXPATHLEN],
  mode_t *expected_mode
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
  if (
    !S_ISDIR(child_stats.st_mode)
    || child_stats.st_uid != root_stats.st_uid
    || !safe_directory_mode(child_stats.st_mode)
  ) {
    return fail_message("authorized child directory ownership changed");
  }
  *expected_mode = child_stats.st_mode & 0777;
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
  const char *crash_stage = getenv("ZEROX_SAFE_FS_TEST_CRASH_STAGE");
  if (!test_stage_selected(stage)) return;
  if (ready != NULL && strcmp(ready, "1") == 0) {
    fprintf(stderr, "zerox-safe-fs-test-ready:%s\n", stage);
    fflush(stderr);
  }
  if (crash_stage != NULL && strcmp(crash_stage, stage) == 0) {
    _exit(86);
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
  const directory_identity *root_identity,
  int child_fd,
  const char *child_path,
  mode_t child_mode
) {
  struct stat root_stats;
  struct stat child_stats;
  int result = verify_fd_path(root_fd, root_path);
  if (result != 0) return result;
  result = verify_fd_path(child_fd, child_path);
  if (result != 0) return result;
  if (
    fstat(root_fd, &root_stats) != 0
    || fstat(child_fd, &child_stats) != 0
  ) {
    return fail_errno("cannot re-inspect authorized directories");
  }
  if (
    !S_ISDIR(root_stats.st_mode)
    || root_stats.st_dev != root_identity->dev
    || root_stats.st_ino != root_identity->ino
    || root_stats.st_uid != root_identity->uid
    || (root_stats.st_mode & 0777) != root_identity->mode
    || !safe_directory_mode(root_stats.st_mode)
    || !S_ISDIR(child_stats.st_mode)
    || child_stats.st_uid != root_stats.st_uid
    || (child_stats.st_mode & 0777) != child_mode
    || !safe_directory_mode(child_stats.st_mode)
  ) {
    return fail_message("authorized directory identity or mode changed");
  }
  return 0;
}

static int capture_directory_identity(
  int directory_fd,
  directory_identity *identity
) {
  struct stat stats;
  if (fstat(directory_fd, &stats) != 0) {
    return fail_errno("cannot inspect directory capability");
  }
  if (!S_ISDIR(stats.st_mode) || !safe_directory_mode(stats.st_mode)) {
    return fail_message("directory capability is unsafe");
  }
  identity->dev = stats.st_dev;
  identity->ino = stats.st_ino;
  identity->uid = stats.st_uid;
  identity->mode = stats.st_mode & 0777;
  return 0;
}

static int verify_opened_regular_path_with_checkpoint(
  int directory_fd,
  const char *directory_path,
  const char *name,
  int file_fd,
  const file_identity *expected,
  int require_single_link,
  int require_private_mode,
  const char *digest_checkpoint
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
    || (require_single_link && opened_stats.st_nlink != 1)
    || (require_private_mode && (opened_stats.st_mode & 0777) != 0600)
    || opened_stats.st_uid != directory_stats.st_uid
    || !stat_matches(&opened_stats, expected)
    || !digest_matches_with_checkpoint(file_fd, expected, digest_checkpoint)
  ) {
    return fail_message("opened regular-file identity changed");
  }
  if (read_regular_at(directory_fd, name, expected, &path_stats) != 0) return 1;
  if (
    (require_single_link && path_stats.st_nlink != 1)
    || !stat_snapshot_matches(&opened_stats, &path_stats)
  ) {
    return fail_message("regular-file path no longer names the opened file");
  }
  return verify_fd_path(file_fd, expected_path);
}

static int verify_opened_regular_path(
  int directory_fd,
  const char *directory_path,
  const char *name,
  int file_fd,
  const file_identity *expected,
  int require_single_link,
  int require_private_mode
) {
  return verify_opened_regular_path_with_checkpoint(
    directory_fd,
    directory_path,
    name,
    file_fd,
    expected,
    require_single_link,
    require_private_mode,
    NULL
  );
}

static int verify_move_authority(
  int root_fd,
  const char *root_path,
  const directory_identity *root_identity,
  int category_fd,
  const char *category_path,
  mode_t category_mode,
  int log_fd,
  const char *log_path,
  mode_t log_mode,
  int journal_fd,
  const char *journal_name,
  const file_identity *journal_identity
) {
  int result = verify_directories(
    root_fd,
    root_path,
    root_identity,
    category_fd,
    category_path,
    category_mode
  );
  if (result != 0) return result;
  result = verify_directories(
    root_fd,
    root_path,
    root_identity,
    log_fd,
    log_path,
    log_mode
  );
  if (result != 0) return result;
  return verify_opened_regular_path(
    log_fd,
    log_path,
    journal_name,
    journal_fd,
    journal_identity,
    1,
    1
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
    || !safe_directory_mode(log_stats.st_mode)
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

static int require_no_reconciliation_marker(
  int log_fd,
  const char *transaction_id
) {
  char marker_name[NAME_MAX + 1];
  struct stat marker_stats;
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
  if (fstatat(log_fd, marker_name, &marker_stats, AT_SYMLINK_NOFOLLOW) == 0) {
    return fail_message("transaction requires manual reconciliation");
  }
  return errno == ENOENT
    ? 0
    : fail_errno("cannot inspect transaction reconciliation state");
}

static int lock_transaction_file(int transaction_fd) {
  return flock(transaction_fd, LOCK_EX | LOCK_NB) == 0
    ? 0
    : fail_errno("transaction is already active");
}

static int record_reconciliation_marker_at(
  int log_fd,
  const char *transaction_id
) {
  char marker_name[NAME_MAX + 1];
  char temporary_name[NAME_MAX + 1];
  const char *body = RECONCILIATION_BODY;
  size_t body_length = strlen(body);
  size_t offset = 0U;
  unsigned int attempt;
  int marker_fd = -1;
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
    O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (marker_fd >= 0) {
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
  if (errno != ENOENT) {
    return fail_errno("cannot inspect existing reconciliation marker");
  }

  for (attempt = 0U; attempt < 16U; attempt += 1U) {
    written = snprintf(
      temporary_name,
      sizeof(temporary_name),
      ".zerox-reconciliation-%ld-%08x.tmp",
      (long)getpid(),
      arc4random()
    );
    if (written < 0 || (size_t)written >= sizeof(temporary_name)) {
      return fail_message("reconciliation marker temporary name is too long");
    }
    marker_fd = openat(
      log_fd,
      temporary_name,
      O_RDWR | O_CLOEXEC | O_NOFOLLOW | O_CREAT | O_EXCL,
      0600
    );
    if (marker_fd >= 0) break;
    if (errno != EEXIST) {
      return fail_errno("cannot create reconciliation marker temporary file");
    }
  }
  if (marker_fd < 0) {
    return fail_message("cannot allocate reconciliation marker temporary file");
  }
  maybe_test_checkpoint("reconciliation-marker-temp-created");
  while (offset < body_length) {
    ssize_t count = write(marker_fd, body + offset, body_length - offset);
    if (count < 0) {
      if (errno == EINTR) continue;
      int write_error = errno;
      close(marker_fd);
      unlinkat(log_fd, temporary_name, 0);
      errno = write_error;
      return fail_errno("cannot write reconciliation marker");
    }
    offset += (size_t)count;
  }
  maybe_test_checkpoint("reconciliation-marker-temp-written");
  if (fsync(marker_fd) != 0) {
    int sync_error = errno;
    close(marker_fd);
    unlinkat(log_fd, temporary_name, 0);
    errno = sync_error;
    return fail_errno("cannot synchronize reconciliation marker");
  }
  maybe_test_checkpoint("reconciliation-marker-temp-synced");
  if (
    validate_reconciliation_marker(log_fd, temporary_name, marker_fd) != 0
  ) {
    close(marker_fd);
    unlinkat(log_fd, temporary_name, 0);
    return fail_message("new reconciliation marker failed self-validation");
  }
  if (close(marker_fd) != 0) {
    int close_error = errno;
    unlinkat(log_fd, temporary_name, 0);
    errno = close_error;
    return fail_errno("cannot close reconciliation marker");
  }
  marker_fd = -1;

  if (
    renameatx_np(
      log_fd,
      temporary_name,
      log_fd,
      marker_name,
      RENAME_EXCL
    ) != 0
  ) {
    int publication_error = errno;
    unlinkat(log_fd, temporary_name, 0);
    if (publication_error != EEXIST) {
      errno = publication_error;
      return fail_errno("cannot publish reconciliation marker");
    }
  }
  maybe_test_checkpoint("reconciliation-marker-published");
  marker_fd = openat(
    log_fd,
    marker_name,
    O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (marker_fd < 0) {
    return fail_errno("cannot open published reconciliation marker");
  }
  if (validate_reconciliation_marker(log_fd, marker_name, marker_fd) != 0) {
    close(marker_fd);
    return fail_message("published reconciliation marker is invalid");
  }
  if (close(marker_fd) != 0) {
    return fail_errno("cannot close published reconciliation marker");
  }
  return fsync(log_fd) == 0
    ? 0
    : fail_errno("cannot synchronize reconciliation directory");
}

static int record_reconciliation_marker(
  int root_fd,
  const char *root_path,
  const directory_identity *root_identity,
  int transaction_fd,
  const char *transaction_id
) {
  unsigned int attempt;
  if (transaction_fd < 0 || lock_transaction_file(transaction_fd) != 0) {
    return fail_message(
      "cannot publish reconciliation marker without transaction authority"
    );
  }
  for (attempt = 0U; attempt < 3U; attempt += 1U) {
    int canonical_log_fd = -1;
    int result;
    char canonical_log_path[MAXPATHLEN];
    mode_t canonical_log_mode = 0;
    result = open_child_directory(
      root_fd,
      root_path,
      TRANSACTION_DIRECTORY,
      1,
      &canonical_log_fd,
      canonical_log_path,
      &canonical_log_mode
    );
    if (result != 0) return result;
    result = verify_directories(
      root_fd,
      root_path,
      root_identity,
      canonical_log_fd,
      canonical_log_path,
      canonical_log_mode
    );
    if (result == 0) {
      result = record_reconciliation_marker_at(
        canonical_log_fd,
        transaction_id
      );
    }
    if (result == 0) {
      result = verify_directories(
        root_fd,
        root_path,
        root_identity,
        canonical_log_fd,
        canonical_log_path,
        canonical_log_mode
      );
    }
    if (result == 0 && fsync(root_fd) != 0) {
      result = fail_errno("cannot synchronize reconciliation root");
    }
    if (close(canonical_log_fd) != 0 && result == 0) {
      result = fail_errno("cannot close reconciliation directory");
    }
    if (result == 0) return 0;
  }
  return fail_message(
    "canonical reconciliation directory changed during marker publication"
  );
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
  const char *source_directory_path,
  const char *source_name,
  int target_fd,
  const char *target_directory_path,
  const char *target_name,
  const file_identity *expected,
  int root_fd,
  const char *root_path,
  const directory_identity *root_identity,
  int category_fd,
  const char *category_path,
  mode_t category_mode,
  int log_fd,
  const char *log_path,
  mode_t log_mode,
  int journal_fd,
  const char *journal_name,
  const file_identity *journal_identity,
  const char *transaction_id
) {
  struct stat source_stats;
  struct stat moved_stats;
  struct stat post_stats;
  int opened_source_fd = -1;
  int result;
  opened_source_fd = openat(
    source_fd,
    source_name,
    O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (opened_source_fd < 0) {
    return fail_errno("cannot open source file capability");
  }
  result = verify_opened_regular_path(
    source_fd,
    source_directory_path,
    source_name,
    opened_source_fd,
    expected,
    0,
    0
  );
  if (result != 0) goto done;
  if (fstat(opened_source_fd, &source_stats) != 0) {
    result = fail_errno("cannot inspect source file capability");
    goto done;
  }
  maybe_test_checkpoint("source-verified");
  result = verify_move_authority(
    root_fd,
    root_path,
    root_identity,
    category_fd,
    category_path,
    category_mode,
    log_fd,
    log_path,
    log_mode,
    journal_fd,
    journal_name,
    journal_identity
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    source_fd,
    source_directory_path,
    source_name,
    opened_source_fd,
    expected,
    0,
    0
  );
  if (result != 0) goto done;
  result = require_no_reconciliation_marker(log_fd, transaction_id);
  if (result != 0) goto done;
  if (
    renameatx_np(
      source_fd,
      source_name,
      target_fd,
      target_name,
      RENAME_EXCL
    ) != 0
  ) {
    result = errno == EEXIST
      ? fail_message("target appeared after preview")
      : fail_errno("cannot atomically move to no-replace target");
    goto done;
  }
  if (fstatat(target_fd, target_name, &moved_stats, AT_SYMLINK_NOFOLLOW) != 0) {
    if (record_reconciliation_marker(
      root_fd,
      root_path,
      root_identity,
      journal_fd,
      transaction_id
    ) != 0) {
      result = fail_message(
        "cannot observe atomically moved target and reconciliation marker could not be persisted"
      );
      goto done;
    }
    result = fail_message(
      "cannot observe atomically moved target; reconciliation marker persisted"
    );
    goto done;
  }
  maybe_test_checkpoint("move-applied");
  result = verify_move_authority(
    root_fd,
    root_path,
    root_identity,
    category_fd,
    category_path,
    category_mode,
    log_fd,
    log_path,
    log_mode,
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
    && verify_opened_regular_path_with_checkpoint(
      target_fd,
      target_directory_path,
      target_name,
      opened_source_fd,
      expected,
      0,
      0,
      "post-move-target-digest-read"
    ) != 0
  ) {
    result = fail_message("cannot verify atomically moved target capability");
  }
  if (
    result == 0
    && fstat(opened_source_fd, &post_stats) != 0
  ) {
    result = fail_errno("cannot re-inspect atomically moved target");
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
  if (result == 0) {
    result = verify_move_authority(
      root_fd,
      root_path,
      root_identity,
      category_fd,
      category_path,
      category_mode,
      log_fd,
      log_path,
      log_mode,
      journal_fd,
      journal_name,
      journal_identity
    );
  }
  if (result == 0) {
    result = verify_opened_regular_path(
      target_fd,
      target_directory_path,
      target_name,
      opened_source_fd,
      expected,
      0,
      0
    );
  }
  if (result == 0) goto done;
  if (
    restore_moved_entry(
      source_fd,
      source_name,
      target_fd,
      target_name,
      &moved_stats
    ) == 0
  ) {
    int restoration_verified = verify_move_authority(
      root_fd,
      root_path,
      root_identity,
      category_fd,
      category_path,
      category_mode,
      log_fd,
      log_path,
      log_mode,
      journal_fd,
      journal_name,
      journal_identity
    );
    if (restoration_verified == 0) {
      restoration_verified = verify_opened_regular_path(
        source_fd,
        source_directory_path,
        source_name,
        opened_source_fd,
        expected,
        0,
        0
      );
    }
    if (restoration_verified == 0) {
      result = fail_message("move postcondition failed; original layout restored");
      goto done;
    }
    if (record_reconciliation_marker(
      root_fd,
      root_path,
      root_identity,
      journal_fd,
      transaction_id
    ) != 0) {
      result = fail_message(
        "move path was restored but authority is unresolved and reconciliation marker could not be persisted"
      );
      goto done;
    }
    result = fail_message(
      "move path was restored but authority is unresolved; reconciliation marker persisted"
    );
    goto done;
  }
  if (record_reconciliation_marker(
    root_fd,
    root_path,
    root_identity,
    journal_fd,
    transaction_id
  ) != 0) {
    result = fail_message(
      "move postcondition failed and reconciliation marker could not be persisted"
    );
    goto done;
  }
  result = fail_message("move postcondition failed; reconciliation marker persisted");
done:
  if (opened_source_fd >= 0) close(opened_source_fd);
  return result;
}

static int run_move(int argc, char **argv, int reverse) {
  directory_identity root_identity;
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
  mode_t category_mode = 0;
  mode_t log_mode = 0;
  int written;
  if (argc != 21) return fail_message("invalid move arguments");
  if (!is_single_component(argv[7]) || !is_category(argv[8]) || !is_single_component(argv[9])) {
    return fail_message("move paths must use allowed single components");
  }
  if (!is_single_component(argv[15])) {
    return fail_message("invalid move transaction id");
  }
  if (!parse_directory_identity(argv[3], argv[4], argv[5], argv[6], &root_identity)) {
    return fail_message("invalid root identity");
  }
  if (!parse_file_identity(
    argv[10], argv[11], argv[12], argv[13], argv[14], &source_identity
  )) {
    return fail_message("invalid source identity");
  }
  if (!parse_file_identity(
    argv[16], argv[17], argv[18], argv[19], argv[20], &journal_identity
  )) {
    return fail_message("invalid journal identity");
  }
  written = snprintf(journal_name, sizeof(journal_name), "%s.json", argv[15]);
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
    category_path,
    &category_mode
  );
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd,
    argv[2],
    TRANSACTION_DIRECTORY,
    0,
    &log_fd,
    log_path,
    &log_mode
  );
  if (result != 0) goto done;
  journal_fd = openat(
    log_fd,
    journal_name,
    O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (journal_fd < 0) {
    result = fail_errno("cannot open transaction journal authority");
    goto done;
  }
  result = lock_transaction_file(journal_fd);
  if (result != 0) goto done;
  result = require_no_reconciliation_marker(log_fd, argv[15]);
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    log_fd,
    log_path,
    journal_name,
    journal_fd,
    &journal_identity,
    1,
    1
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("journal-bound");
  maybe_test_checkpoint("directories-opened");
  result = verify_move_authority(
    root_fd,
    argv[2],
    &root_identity,
    category_fd,
    category_path,
    category_mode,
    log_fd,
    log_path,
    log_mode,
    journal_fd,
    journal_name,
    &journal_identity
  );
  if (result != 0) goto done;
  result = reverse
    ? move_between_directories(
        category_fd,
        category_path,
        argv[7],
        root_fd,
        argv[2],
        argv[9],
        &source_identity,
        root_fd,
        argv[2],
        &root_identity,
        category_fd,
        category_path,
        category_mode,
        log_fd,
        log_path,
        log_mode,
        journal_fd,
        journal_name,
        &journal_identity,
        argv[15]
      )
    : move_between_directories(
        root_fd,
        argv[2],
        argv[7],
        category_fd,
        category_path,
        argv[9],
        &source_identity,
        root_fd,
        argv[2],
        &root_identity,
        category_fd,
        category_path,
        category_mode,
        log_fd,
        log_path,
        log_mode,
        journal_fd,
        journal_name,
        &journal_identity,
        argv[15]
      );
  if (result == 0) {
    maybe_test_checkpoint("move-before-success");
    result = require_no_reconciliation_marker(log_fd, argv[15]);
  }
done:
  if (journal_fd >= 0) close(journal_fd);
  if (log_fd >= 0) close(log_fd);
  if (category_fd >= 0) close(category_fd);
  if (root_fd >= 0) close(root_fd);
  if (result == 0) puts("{\"ok\":true}");
  return result;
}

static int run_verify_into_category(int argc, char **argv) {
  directory_identity root_identity;
  file_identity source_identity;
  file_identity journal_identity;
  struct stat unexpected_source;
  int root_fd = -1;
  int category_fd = -1;
  int log_fd = -1;
  int journal_fd = -1;
  int target_fd = -1;
  int result = 0;
  char category_path[MAXPATHLEN];
  char log_path[MAXPATHLEN];
  char journal_name[NAME_MAX + 1];
  mode_t category_mode = 0;
  mode_t log_mode = 0;
  int written;
  if (argc != 21) return fail_message("invalid verify arguments");
  if (
    !is_single_component(argv[7])
    || !is_category(argv[8])
    || !is_single_component(argv[9])
    || !is_single_component(argv[15])
  ) {
    return fail_message("verify paths must use allowed single components");
  }
  if (!parse_directory_identity(argv[3], argv[4], argv[5], argv[6], &root_identity)) {
    return fail_message("invalid verify root identity");
  }
  if (!parse_file_identity(
    argv[10], argv[11], argv[12], argv[13], argv[14], &source_identity
  )) {
    return fail_message("invalid verify source identity");
  }
  if (!parse_file_identity(
    argv[16], argv[17], argv[18], argv[19], argv[20], &journal_identity
  )) {
    return fail_message("invalid verify journal identity");
  }
  written = snprintf(journal_name, sizeof(journal_name), "%s.json", argv[15]);
  if (written < 0 || (size_t)written >= sizeof(journal_name)) {
    return fail_message("verify journal name is too long");
  }
  result = open_root(argv[2], &root_identity, &root_fd);
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd,
    argv[2],
    argv[8],
    0,
    &category_fd,
    category_path,
    &category_mode
  );
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd,
    argv[2],
    TRANSACTION_DIRECTORY,
    0,
    &log_fd,
    log_path,
    &log_mode
  );
  if (result != 0) goto done;
  journal_fd = openat(
    log_fd,
    journal_name,
    O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (journal_fd < 0) {
    result = fail_errno("cannot open verify journal authority");
    goto done;
  }
  result = lock_transaction_file(journal_fd);
  if (result != 0) goto done;
  result = require_no_reconciliation_marker(log_fd, argv[15]);
  if (result != 0) goto done;
  target_fd = openat(
    category_fd,
    argv[9],
    O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (target_fd < 0) {
    result = fail_errno("cannot open verified target capability");
    goto done;
  }
  result = verify_move_authority(
    root_fd,
    argv[2],
    &root_identity,
    category_fd,
    category_path,
    category_mode,
    log_fd,
    log_path,
    log_mode,
    journal_fd,
    journal_name,
    &journal_identity
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    category_fd,
    category_path,
    argv[9],
    target_fd,
    &source_identity,
    0,
    0
  );
  if (result != 0) goto done;
  if (fstatat(root_fd, argv[7], &unexpected_source, AT_SYMLINK_NOFOLLOW) == 0) {
    result = fail_message("verified source path is not retired");
    goto done;
  }
  if (errno != ENOENT) {
    result = fail_errno("cannot verify source retirement");
    goto done;
  }
  result = verify_move_authority(
    root_fd,
    argv[2],
    &root_identity,
    category_fd,
    category_path,
    category_mode,
    log_fd,
    log_path,
    log_mode,
    journal_fd,
    journal_name,
    &journal_identity
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    category_fd,
    category_path,
    argv[9],
    target_fd,
    &source_identity,
    0,
    0
  );
  if (result == 0) {
    maybe_test_checkpoint("verify-before-success");
    result = require_no_reconciliation_marker(log_fd, argv[15]);
  }
done:
  if (target_fd >= 0) close(target_fd);
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
        unsigned char extra;
        do {
          count = read(STDIN_FILENO, &extra, 1U);
        } while (count < 0 && errno == EINTR);
        if (count == 0) break;
        free(buffer);
        return count < 0
          ? fail_errno("cannot read transaction log input")
          : fail_message("transaction log exceeds the safe size limit");
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

static int capture_file_identity(
  int fd,
  const struct stat *stats,
  file_identity *identity
) {
  struct stat after;
  if (sha256_fd(fd, identity->sha256) != 0) return 1;
  if (fstat(fd, &after) != 0) {
    return fail_errno("cannot inspect captured regular file identity");
  }
  if (!stat_snapshot_matches(stats, &after)) {
    return fail_message("regular-file identity changed while capturing authority");
  }
  identity->dev = after.st_dev;
  identity->ino = after.st_ino;
  identity->size = after.st_size;
  identity->uid = after.st_uid;
  return 0;
}

static void print_identity(const file_identity *identity) {
  printf(
    "{\"ok\":true,\"identity\":{\"dev\":\"%llu\",\"ino\":\"%llu\","
    "\"size\":\"%llu\",\"uid\":\"%llu\",\"sha256\":\"sha256:%s\"}}\n",
    (unsigned long long)identity->dev,
    (unsigned long long)identity->ino,
    (unsigned long long)identity->size,
    (unsigned long long)identity->uid,
    identity->sha256
  );
}

static int run_log(int argc, char **argv, int append) {
  directory_identity root_identity;
  file_identity expected_log;
  file_identity opened_identity;
  file_identity final_identity;
  struct stat opened_stats;
  struct stat final_stats;
  int root_fd = -1;
  int log_fd = -1;
  int output_fd = -1;
  int result = 0;
  int saved_errno;
  int mutation_started = 0;
  int transaction_lock_acquired = 0;
  char log_path[MAXPATHLEN];
  char final_name[NAME_MAX + 1];
  char *body = NULL;
  size_t body_length = 0U;
  mode_t log_mode = 0;
  int written;
  if (argc != (append ? 13 : 8)) return fail_message("invalid log arguments");
  if (!is_single_component(argv[7])) return fail_message("invalid transaction id");
  if (!parse_directory_identity(argv[3], argv[4], argv[5], argv[6], &root_identity)) {
    return fail_message("invalid root identity");
  }
  if (
    append &&
    !parse_file_identity(
      argv[8], argv[9], argv[10], argv[11], argv[12], &expected_log
    )
  ) {
    return fail_message("invalid existing log identity");
  }
  written = snprintf(final_name, sizeof(final_name), "%s.json", argv[7]);
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
    log_path,
    &log_mode
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("directories-opened");
  result = verify_directories(
    root_fd, argv[2], &root_identity, log_fd, log_path, log_mode
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("log-before-mutation");
  result = verify_directories(
    root_fd, argv[2], &root_identity, log_fd, log_path, log_mode
  );
  if (result != 0) goto done;
  result = require_no_reconciliation_marker(log_fd, argv[7]);
  if (result != 0) goto done;
  output_fd = openat(
    log_fd,
    final_name,
    O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW |
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
  result = lock_transaction_file(output_fd);
  if (result != 0) goto done;
  transaction_lock_acquired = 1;
  result = require_no_reconciliation_marker(log_fd, argv[7]);
  if (result != 0) goto done;
  if (fstat(output_fd, &opened_stats) != 0) {
    result = fail_errno("cannot inspect opened transaction log");
    goto done;
  }
  if (
    opened_stats.st_size < 0
    || (uint64_t)opened_stats.st_size > (uint64_t)MAX_LOG_BYTES
    || body_length > MAX_LOG_BYTES - (size_t)opened_stats.st_size
  ) {
    result = fail_message("transaction log exceeds the safe size limit");
    goto done;
  }
  if (
    !S_ISREG(opened_stats.st_mode)
    || opened_stats.st_nlink != 1
    || (opened_stats.st_mode & 0777) != 0600
    || opened_stats.st_uid != root_identity.uid
    || capture_file_identity(output_fd, &opened_stats, &opened_identity) != 0
  ) {
    result = fail_message("opened transaction log identity changed");
    goto done;
  }
  if (append && (
    !stat_matches(&opened_stats, &expected_log)
    || strcmp(opened_identity.sha256, expected_log.sha256) != 0
  )) {
    result = fail_message("opened transaction log content authority changed");
    goto done;
  }
  result = verify_opened_regular_path(
    log_fd,
    log_path,
    final_name,
    output_fd,
    append ? &expected_log : &opened_identity,
    1,
    1
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("log-opened");
  result = verify_directories(
    root_fd, argv[2], &root_identity, log_fd, log_path, log_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    log_fd,
    log_path,
    final_name,
    output_fd,
    append ? &expected_log : &opened_identity,
    1,
    1
  );
  if (result != 0) goto done;
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
  if (
    !S_ISREG(final_stats.st_mode)
    || final_stats.st_nlink != 1
    || (final_stats.st_mode & 0777) != 0600
    || final_stats.st_uid != root_identity.uid
    || capture_file_identity(output_fd, &final_stats, &final_identity) != 0
  ) {
    result = fail_message("written transaction log identity is unsafe");
    goto done;
  }
  maybe_test_checkpoint("log-mutated");
  result = verify_directories(
    root_fd, argv[2], &root_identity, log_fd, log_path, log_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    log_fd,
    log_path,
    final_name,
    output_fd,
    &final_identity,
    1,
    1
  );
  if (result != 0) goto done;
  if (fsync(log_fd) != 0 || fsync(root_fd) != 0) {
    result = fail_errno("cannot synchronize transaction directory");
    goto done;
  }
  result = verify_directories(
    root_fd, argv[2], &root_identity, log_fd, log_path, log_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    log_fd,
    log_path,
    final_name,
    output_fd,
    &final_identity,
    1,
    1
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("log-before-success");
  result = require_no_reconciliation_marker(log_fd, argv[7]);
  if (result != 0) goto done;
  print_identity(&final_identity);
  if (close(output_fd) != 0) {
    output_fd = -1;
    result = fail_errno("cannot close transaction log");
    goto done;
  }
  output_fd = -1;
done:
  saved_errno = errno;
  if (
    result != 0
    && (mutation_started || (append && transaction_lock_acquired))
    && log_fd >= 0
  ) {
    if (record_reconciliation_marker(
      root_fd,
      argv[2],
      &root_identity,
      output_fd,
      argv[7]
    ) != 0) {
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

static int open_plan_directories(
  int root_fd,
  const char *root_path,
  const directory_identity *root_identity,
  int allow_create,
  int *zerox_fd,
  char zerox_path[MAXPATHLEN],
  directory_identity *zerox_identity,
  mode_t *zerox_mode,
  int *plans_fd,
  char plans_path[MAXPATHLEN],
  mode_t *plans_mode
) {
  int result = open_child_directory(
    root_fd,
    root_path,
    ZEROX_DIRECTORY,
    allow_create,
    zerox_fd,
    zerox_path,
    zerox_mode
  );
  if (result != 0) return result;
  result = verify_directories(
    root_fd,
    root_path,
    root_identity,
    *zerox_fd,
    zerox_path,
    *zerox_mode
  );
  if (result != 0) return result;
  result = capture_directory_identity(*zerox_fd, zerox_identity);
  if (result != 0) return result;
  return open_child_directory(
    *zerox_fd,
    zerox_path,
    PLAN_DIRECTORY,
    allow_create,
    plans_fd,
    plans_path,
    plans_mode
  );
}

static int verify_plan_directories(
  int root_fd,
  const char *root_path,
  const directory_identity *root_identity,
  int zerox_fd,
  const char *zerox_path,
  const directory_identity *zerox_identity,
  mode_t zerox_mode,
  int plans_fd,
  const char *plans_path,
  mode_t plans_mode
) {
  int result = verify_directories(
    root_fd,
    root_path,
    root_identity,
    zerox_fd,
    zerox_path,
    zerox_mode
  );
  if (result != 0) return result;
  return verify_directories(
    zerox_fd,
    zerox_path,
    zerox_identity,
    plans_fd,
    plans_path,
    plans_mode
  );
}

static int open_expected_projection(
  int plans_fd,
  const char *plans_path,
  const char *final_name,
  const char *expected_value,
  const char *next_digest,
  uid_t expected_uid,
  int *existing_fd,
  file_identity *existing_identity,
  int *expect_absent,
  int *already_published
) {
  struct stat stats;
  char actual_digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
  char expected_digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
  *expect_absent = strcmp(expected_value, "absent") == 0;
  *already_published = 0;
  if (
    !*expect_absent
    && !parse_sha256_value(expected_value, expected_digest)
  ) {
    return fail_message("invalid expected plan projection digest");
  }
  *existing_fd = openat(
    plans_fd,
    final_name,
    O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (*existing_fd < 0) {
    if (errno == ENOENT && *expect_absent) return 0;
    return fail_errno("cannot open expected plan projection capability");
  }
  if (fstat(*existing_fd, &stats) != 0) {
    return fail_errno("cannot inspect expected plan projection");
  }
  if (
    !S_ISREG(stats.st_mode)
    || stats.st_nlink != 1
    || (stats.st_mode & 0777) != 0600
    || stats.st_uid != expected_uid
  ) {
    return fail_message("expected plan projection metadata is unsafe");
  }
  existing_identity->dev = stats.st_dev;
  existing_identity->ino = stats.st_ino;
  existing_identity->size = stats.st_size;
  existing_identity->uid = stats.st_uid;
  if (sha256_fd(*existing_fd, actual_digest) != 0) {
    return fail_message("cannot read expected plan projection digest");
  }
  if (strcmp(actual_digest, next_digest) == 0) {
    *already_published = 1;
  } else if (*expect_absent) {
    return fail_message("plan projection appeared without prior authority");
  } else if (strcmp(actual_digest, expected_digest) != 0) {
    return fail_message("expected plan projection content authority changed");
  }
  memcpy(existing_identity->sha256, actual_digest, sizeof(existing_identity->sha256));
  return verify_opened_regular_path(
    plans_fd,
    plans_path,
    final_name,
    *existing_fd,
    existing_identity,
    1,
    1
  );
}

static int run_projection_verify(int argc, char **argv) {
  directory_identity root_identity;
  directory_identity zerox_identity;
  file_identity projection_identity;
  struct stat projection_stats;
  int root_fd = -1;
  int zerox_fd = -1;
  int plans_fd = -1;
  int projection_fd = -1;
  int result = 0;
  char zerox_path[MAXPATHLEN];
  char plans_path[MAXPATHLEN];
  char final_name[NAME_MAX + 1];
  mode_t zerox_mode = 0;
  mode_t plans_mode = 0;
  int written;
  if (argc != 9) return fail_message("invalid projection verify arguments");
  if (!is_single_component(argv[7])) return fail_message("invalid plan id");
  if (!parse_directory_identity(argv[3], argv[4], argv[5], argv[6], &root_identity)) {
    return fail_message("invalid projection root identity");
  }
  if (!parse_sha256_value(argv[8], projection_identity.sha256)) {
    return fail_message("invalid plan projection digest");
  }
  written = snprintf(final_name, sizeof(final_name), "%s.md", argv[7]);
  if (written < 0 || (size_t)written >= sizeof(final_name)) {
    return fail_message("plan projection name is too long");
  }
  result = open_root(argv[2], &root_identity, &root_fd);
  if (result != 0) goto done;
  result = open_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    0,
    &zerox_fd,
    zerox_path,
    &zerox_identity,
    &zerox_mode,
    &plans_fd,
    plans_path,
    &plans_mode
  );
  if (result != 0) goto done;
  projection_fd = openat(
    plans_fd,
    final_name,
    O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (projection_fd < 0) {
    result = fail_errno("cannot open plan projection capability");
    goto done;
  }
  if (fstat(projection_fd, &projection_stats) != 0) {
    result = fail_errno("cannot inspect plan projection capability");
    goto done;
  }
  if (
    !S_ISREG(projection_stats.st_mode)
    || projection_stats.st_nlink != 1
    || (projection_stats.st_mode & 0777) != 0600
    || projection_stats.st_uid != root_identity.uid
  ) {
    result = fail_message("plan projection metadata is unsafe");
    goto done;
  }
  projection_identity.dev = projection_stats.st_dev;
  projection_identity.ino = projection_stats.st_ino;
  projection_identity.size = projection_stats.st_size;
  projection_identity.uid = projection_stats.st_uid;
  if (!digest_matches_with_checkpoint(projection_fd, &projection_identity, NULL)) {
    result = fail_message("plan projection digest changed");
    goto done;
  }
  result = verify_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    zerox_fd,
    zerox_path,
    &zerox_identity,
    zerox_mode,
    plans_fd,
    plans_path,
    plans_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    final_name,
    projection_fd,
    &projection_identity,
    1,
    1
  );
done:
  if (projection_fd >= 0) close(projection_fd);
  if (plans_fd >= 0) close(plans_fd);
  if (zerox_fd >= 0) close(zerox_fd);
  if (root_fd >= 0) close(root_fd);
  if (result == 0) puts("{\"ok\":true}");
  return result;
}

static int open_projection_transaction(
  int plans_fd,
  const char *plans_path,
  const char *transaction_name,
  uid_t expected_uid,
  int *transaction_fd,
  file_identity *transaction_identity,
  int *absent
) {
  struct stat stats;
  *absent = 0;
  *transaction_fd = openat(
    plans_fd,
    transaction_name,
    O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW
  );
  if (*transaction_fd < 0) {
    if (errno == ENOENT) {
      *absent = 1;
      return 0;
    }
    return fail_errno("cannot open plan projection transaction");
  }
  if (fstat(*transaction_fd, &stats) != 0) {
    return fail_errno("cannot inspect plan projection transaction");
  }
  if (
    !S_ISREG(stats.st_mode)
    || stats.st_nlink != 1
    || (stats.st_mode & 0777) != 0600
    || stats.st_uid != expected_uid
    || capture_file_identity(
      *transaction_fd,
      &stats,
      transaction_identity
    ) != 0
  ) {
    return fail_message("plan projection transaction authority is unsafe");
  }
  return verify_opened_regular_path(
    plans_fd,
    plans_path,
    transaction_name,
    *transaction_fd,
    transaction_identity,
    1,
    1
  );
}

static int scrub_projection_descriptor(
  int transaction_fd,
  file_identity *transaction_identity
) {
  struct stat scrubbed_stats;
  if (
    fstat(transaction_fd, &scrubbed_stats) != 0
    || !S_ISREG(scrubbed_stats.st_mode)
    || scrubbed_stats.st_dev != transaction_identity->dev
    || scrubbed_stats.st_ino != transaction_identity->ino
    || scrubbed_stats.st_uid != transaction_identity->uid
    || scrubbed_stats.st_nlink > 1
  ) {
    return fail_message("retired plan projection descriptor is unsafe");
  }
  if (ftruncate(transaction_fd, 0) != 0 || fsync(transaction_fd) != 0) {
    return fail_errno("cannot scrub retired plan projection transaction");
  }
  if (fstat(transaction_fd, &scrubbed_stats) != 0) {
    return fail_errno("cannot inspect scrubbed plan projection transaction");
  }
  if (
    !S_ISREG(scrubbed_stats.st_mode)
    || scrubbed_stats.st_size != 0
    || scrubbed_stats.st_dev != transaction_identity->dev
    || scrubbed_stats.st_ino != transaction_identity->ino
    || scrubbed_stats.st_uid != transaction_identity->uid
    || scrubbed_stats.st_nlink > 1
    || capture_file_identity(
      transaction_fd,
      &scrubbed_stats,
      transaction_identity
    ) != 0
  ) {
    return fail_message("retired plan projection transaction was not scrubbed");
  }
  return 0;
}

static int scrub_projection_transaction(
  int plans_fd,
  const char *plans_path,
  const char *transaction_name,
  int transaction_fd,
  file_identity *transaction_identity
) {
  int result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    transaction_name,
    transaction_fd,
    transaction_identity,
    1,
    1
  );
  if (result != 0) return result;
  result = scrub_projection_descriptor(transaction_fd, transaction_identity);
  if (result != 0) return result;
  return verify_opened_regular_path(
    plans_fd,
    plans_path,
    transaction_name,
    transaction_fd,
    transaction_identity,
    1,
    1
  );
}

static int run_projection_write(int argc, char **argv) {
  directory_identity root_identity;
  directory_identity zerox_identity;
  file_identity existing_identity;
  file_identity lock_identity;
  file_identity output_identity;
  struct stat lock_stats;
  struct stat output_stats;
  int root_fd = -1;
  int zerox_fd = -1;
  int plans_fd = -1;
  int existing_fd = -1;
  int lock_fd = -1;
  int output_fd = -1;
  int output_owned = 0;
  int result = 0;
  int expect_absent = 0;
  int already_published = 0;
  int published = 0;
  int swapped = 0;
  int swap_durable = 0;
  int transaction_absent = 0;
  char zerox_path[MAXPATHLEN];
  char plans_path[MAXPATHLEN];
  char final_name[NAME_MAX + 1];
  char lock_name[NAME_MAX + 1];
  char temporary_name[NAME_MAX + 1];
  char body_digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
  char expected_digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
  char next_digest[CC_SHA256_DIGEST_LENGTH * 2U + 1U];
  char *body = NULL;
  size_t body_length = 0U;
  mode_t zerox_mode = 0;
  mode_t plans_mode = 0;
  int written;
  if (argc != 10) return fail_message("invalid projection write arguments");
  if (!is_single_component(argv[7])) return fail_message("invalid plan id");
  if (!parse_directory_identity(argv[3], argv[4], argv[5], argv[6], &root_identity)) {
    return fail_message("invalid projection root identity");
  }
  written = snprintf(final_name, sizeof(final_name), "%s.md", argv[7]);
  if (written < 0 || (size_t)written >= sizeof(final_name)) {
    return fail_message("plan projection name is too long");
  }
  written = snprintf(lock_name, sizeof(lock_name), ".%s.projection.lock", argv[7]);
  if (written < 0 || (size_t)written >= sizeof(lock_name)) {
    return fail_message("plan projection lock name is too long");
  }
  written = snprintf(
    temporary_name,
    sizeof(temporary_name),
    ".%s.projection.transaction",
    argv[7]
  );
  if (written < 0 || (size_t)written >= sizeof(temporary_name)) {
    return fail_message("plan projection transaction name is too long");
  }
  if (!parse_sha256_value(argv[9], next_digest)) {
    return fail_message("invalid next plan projection digest");
  }
  if (
    strcmp(argv[8], "absent") != 0
    && !parse_sha256_value(argv[8], expected_digest)
  ) {
    return fail_message("invalid expected plan projection digest");
  }
  result = read_stdin_body(&body, &body_length);
  if (result != 0) goto done;
  result = sha256_bytes(body, body_length, body_digest);
  if (result != 0) goto done;
  if (strcmp(body_digest, next_digest) != 0) {
    result = fail_message("plan projection body does not match next digest");
    goto done;
  }
  result = open_root(argv[2], &root_identity, &root_fd);
  if (result != 0) goto done;
  result = open_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    1,
    &zerox_fd,
    zerox_path,
    &zerox_identity,
    &zerox_mode,
    &plans_fd,
    plans_path,
    &plans_mode
  );
  if (result != 0) goto done;
  lock_fd = openat(
    plans_fd,
    lock_name,
    O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW | O_CREAT,
    0600
  );
  if (lock_fd < 0) {
    result = fail_errno("cannot open plan projection lock");
    goto done;
  }
  if (
    fstat(lock_fd, &lock_stats) != 0
    || !S_ISREG(lock_stats.st_mode)
    || lock_stats.st_nlink != 1
    || (lock_stats.st_mode & 0777) != 0600
    || lock_stats.st_uid != root_identity.uid
    || capture_file_identity(lock_fd, &lock_stats, &lock_identity) != 0
  ) {
    result = fail_message("plan projection lock authority is unsafe");
    goto done;
  }
  result = lock_transaction_file(lock_fd);
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    lock_name,
    lock_fd,
    &lock_identity,
    1,
    1
  );
  if (result != 0) goto done;
  maybe_test_checkpoint("projection-directories-opened");
  result = verify_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    zerox_fd,
    zerox_path,
    &zerox_identity,
    zerox_mode,
    plans_fd,
    plans_path,
    plans_mode
  );
  if (result != 0) goto done;
  result = open_expected_projection(
    plans_fd,
    plans_path,
    final_name,
    argv[8],
    next_digest,
    root_identity.uid,
    &existing_fd,
    &existing_identity,
    &expect_absent,
    &already_published
  );
  if (result != 0) goto done;
  if (already_published) {
    published = 1;
    result = open_projection_transaction(
      plans_fd,
      plans_path,
      temporary_name,
      root_identity.uid,
      &output_fd,
      &output_identity,
      &transaction_absent
    );
    if (result != 0) goto done;
    if (!transaction_absent) {
      if (
        strcmp(
          output_identity.sha256,
          "e3b0c44298fc1c149afbf4c8996fb924"
          "27ae41e4649b934ca495991b7852b855"
        ) != 0
      ) {
        if (
          expect_absent
          || strcmp(output_identity.sha256, expected_digest) != 0
        ) {
          result = fail_message(
            "plan projection transaction does not match retired authority"
          );
          goto done;
        }
        result = scrub_projection_transaction(
          plans_fd,
          plans_path,
          temporary_name,
          output_fd,
          &output_identity
        );
        if (result != 0) goto done;
      }
    }
    if (
      fsync(plans_fd) != 0
      || fsync(zerox_fd) != 0
      || fsync(root_fd) != 0
    ) {
      result = fail_errno("cannot synchronize idempotent plan projection");
      goto done;
    }
    result = verify_plan_directories(
      root_fd,
      argv[2],
      &root_identity,
      zerox_fd,
      zerox_path,
      &zerox_identity,
      zerox_mode,
      plans_fd,
      plans_path,
      plans_mode
    );
    if (result != 0) goto done;
    result = verify_opened_regular_path(
      plans_fd,
      plans_path,
      lock_name,
      lock_fd,
      &lock_identity,
      1,
      1
    );
    if (result != 0) goto done;
    result = verify_opened_regular_path(
      plans_fd,
      plans_path,
      final_name,
      existing_fd,
      &existing_identity,
      1,
      1
    );
    if (result != 0) goto done;
    if (!transaction_absent) {
      result = verify_opened_regular_path(
        plans_fd,
        plans_path,
        temporary_name,
        output_fd,
        &output_identity,
        1,
        1
      );
      if (result != 0) goto done;
    }
    print_identity(&existing_identity);
    goto done;
  }
  result = open_projection_transaction(
    plans_fd,
    plans_path,
    temporary_name,
    root_identity.uid,
    &output_fd,
    &output_identity,
    &transaction_absent
  );
  if (result != 0) goto done;
  if (transaction_absent) {
    output_fd = openat(
      plans_fd,
      temporary_name,
      O_RDWR | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW | O_CREAT | O_EXCL,
      0600
    );
    if (output_fd < 0) {
      result = fail_errno("cannot create plan projection transaction");
      goto done;
    }
    output_owned = 1;
  } else if (strcmp(output_identity.sha256, next_digest) == 0) {
    output_owned = 1;
    goto projection_prepared;
  }
  /*
   * Before publication the canonical leaf still proves expected authority.
   * Any safe, single-link transaction bytes that are neither empty nor the
   * exact next digest are therefore interrupted scratch from a prior writer.
   * Reuse the already-open descriptor and rewrite it; after publication the
   * idempotent branch above remains strict and accepts only empty or the exact
   * retired digest.
   */
  output_owned = 1;
  if (ftruncate(output_fd, 0) != 0 || lseek(output_fd, 0, SEEK_SET) < 0) {
    result = fail_errno("cannot prepare plan projection transaction");
    goto done;
  }
  result = write_all(output_fd, body, body_length);
  if (result != 0 || fsync(output_fd) != 0) {
    if (result == 0) result = fail_errno("cannot synchronize plan projection");
    goto done;
  }
  if (fstat(output_fd, &output_stats) != 0) {
    result = fail_errno("cannot inspect plan projection temporary file");
    goto done;
  }
  if (
    !S_ISREG(output_stats.st_mode)
    || output_stats.st_nlink != 1
    || (output_stats.st_mode & 0777) != 0600
    || output_stats.st_uid != root_identity.uid
    || capture_file_identity(output_fd, &output_stats, &output_identity) != 0
  ) {
    result = fail_message("plan projection temporary authority is unsafe");
    goto done;
  }
projection_prepared:
  maybe_test_checkpoint("projection-before-publish");
  result = verify_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    zerox_fd,
    zerox_path,
    &zerox_identity,
    zerox_mode,
    plans_fd,
    plans_path,
    plans_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    lock_name,
    lock_fd,
    &lock_identity,
    1,
    1
  );
  if (result != 0) goto done;
  if (expect_absent) {
    struct stat unexpected;
    if (fstatat(plans_fd, final_name, &unexpected, AT_SYMLINK_NOFOLLOW) == 0) {
      result = fail_message("plan projection appeared before publication");
      goto done;
    }
    if (errno != ENOENT) {
      result = fail_errno("cannot verify plan projection publication authority");
      goto done;
    }
    if (renameatx_np(
      plans_fd,
      temporary_name,
      plans_fd,
      final_name,
      RENAME_EXCL
    ) != 0) {
      result = fail_errno("cannot publish new plan projection");
      goto done;
    }
  } else {
    result = verify_opened_regular_path(
      plans_fd,
      plans_path,
      final_name,
      existing_fd,
      &existing_identity,
      1,
      1
    );
    if (result != 0) goto done;
    if (renameatx_np(
      plans_fd,
      temporary_name,
      plans_fd,
      final_name,
      RENAME_SWAP
    ) != 0) {
      result = fail_errno("cannot atomically replace plan projection");
      goto done;
    }
    swapped = 1;
    /*
     * Commit the exchange itself before retiring the old inode. Otherwise a
     * power loss could restore the old directory entry after its descriptor
     * had already been truncated. This fsync uses the capability-bound plans
     * descriptor and intentionally precedes every pathname postflight.
     */
    if (fsync(plans_fd) != 0) {
      result = fail_errno("cannot synchronize plan projection exchange");
      goto done;
    }
    swap_durable = 1;
    maybe_test_checkpoint("projection-swap-durable");
    /*
     * The durable old canonical inode is now known exactly through
     * existing_fd. Scrub it before any pathname postflight so a concurrent
     * displacement can make the operation fail but cannot preserve retired
     * Plan bytes in the deterministic transaction inode.
     */
    result = scrub_projection_descriptor(existing_fd, &existing_identity);
    if (result != 0) goto done;
  }
  published = 1;
  maybe_test_checkpoint("projection-published");
  result = verify_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    zerox_fd,
    zerox_path,
    &zerox_identity,
    zerox_mode,
    plans_fd,
    plans_path,
    plans_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    lock_name,
    lock_fd,
    &lock_identity,
    1,
    1
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    final_name,
    output_fd,
    &output_identity,
    1,
    1
  );
  if (result != 0) goto done;
  if (swapped) {
    result = verify_opened_regular_path(
      plans_fd,
      plans_path,
      temporary_name,
      existing_fd,
      &existing_identity,
      1,
      1
    );
    if (result != 0) goto done;
  }
  if (
    fsync(plans_fd) != 0
    || fsync(zerox_fd) != 0
    || fsync(root_fd) != 0
  ) {
    result = fail_errno("cannot synchronize plan projection directories");
    goto done;
  }
  maybe_test_checkpoint("projection-before-success");
  result = verify_plan_directories(
    root_fd,
    argv[2],
    &root_identity,
    zerox_fd,
    zerox_path,
    &zerox_identity,
    zerox_mode,
    plans_fd,
    plans_path,
    plans_mode
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    lock_name,
    lock_fd,
    &lock_identity,
    1,
    1
  );
  if (result != 0) goto done;
  result = verify_opened_regular_path(
    plans_fd,
    plans_path,
    final_name,
    output_fd,
    &output_identity,
    1,
    1
  );
  if (result != 0) goto done;
  if (swapped) {
    result = scrub_projection_transaction(
      plans_fd,
      plans_path,
      temporary_name,
      existing_fd,
      &existing_identity
    );
    if (result != 0) goto done;
    if (fsync(plans_fd) != 0) {
      result = fail_errno("cannot synchronize scrubbed plan projection transaction");
      goto done;
    }
    result = verify_opened_regular_path(
      plans_fd,
      plans_path,
      final_name,
      output_fd,
      &output_identity,
      1,
      1
    );
    if (result != 0) goto done;
    result = verify_opened_regular_path(
      plans_fd,
      plans_path,
      temporary_name,
      existing_fd,
      &existing_identity,
      1,
      1
    );
    if (result != 0) goto done;
  }
  print_identity(&output_identity);
done:
  if (swap_durable && existing_fd >= 0 && existing_identity.size > 0) {
    (void)scrub_projection_descriptor(existing_fd, &existing_identity);
  }
  if (!published && plans_fd >= 0 && output_fd >= 0 && output_owned) {
    struct stat cleanup_stats;
    file_identity cleanup_identity;
    if (
      fstat(output_fd, &cleanup_stats) == 0
      && S_ISREG(cleanup_stats.st_mode)
      && cleanup_stats.st_nlink == 1
      && capture_file_identity(
        output_fd,
        &cleanup_stats,
        &cleanup_identity
      ) == 0
      && verify_opened_regular_path(
        plans_fd,
        plans_path,
        temporary_name,
        output_fd,
        &cleanup_identity,
        1,
        1
      ) == 0
    ) {
      (void)scrub_projection_transaction(
        plans_fd,
        plans_path,
        temporary_name,
        output_fd,
        &cleanup_identity
      );
    }
  }
  if (output_fd >= 0) close(output_fd);
  if (existing_fd >= 0) close(existing_fd);
  if (lock_fd >= 0) close(lock_fd);
  if (plans_fd >= 0) close(plans_fd);
  if (zerox_fd >= 0) close(zerox_fd);
  if (root_fd >= 0) close(root_fd);
  free(body);
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
  if (strcmp(argv[1], "verify-into-category") == 0) {
    return run_verify_into_category(argc, argv);
  }
  if (strcmp(argv[1], "log-create") == 0) {
    return run_log(argc, argv, 0);
  }
  if (strcmp(argv[1], "log-append") == 0) {
    return run_log(argc, argv, 1);
  }
  if (strcmp(argv[1], "projection-write") == 0) {
    return run_projection_write(argc, argv);
  }
  if (strcmp(argv[1], "projection-verify") == 0) {
    return run_projection_verify(argc, argv);
  }
  return fail_message("unknown command");
}
