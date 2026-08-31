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

static void maybe_test_delay(void) {
  const char *value = getenv("ZEROX_SAFE_FS_TEST_DELAY_MS");
  uint64_t delay_ms = 0;
  if (value == NULL || !parse_u64(value, &delay_ms) || delay_ms > 5000U) return;
  if (delay_ms > 0U) usleep((useconds_t)(delay_ms * 1000U));
}

static void maybe_signal_test_ready(void) {
  const char *value = getenv("ZEROX_SAFE_FS_TEST_READY");
  if (value == NULL || strcmp(value, "1") != 0) return;
  fputs("zerox-safe-fs-test-ready\n", stderr);
  fflush(stderr);
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

static int move_between_directories(
  int source_fd,
  const char *source_name,
  int target_fd,
  const char *target_name,
  const file_identity *expected
) {
  struct stat source_stats;
  struct stat target_stats;
  int saved_errno;
  int result = read_regular_at(source_fd, source_name, expected, &source_stats);
  if (result != 0) return result;
  if (linkat(source_fd, source_name, target_fd, target_name, 0) != 0) {
    if (errno == EEXIST) return fail_message("target appeared after preview");
    return fail_errno("cannot create no-replace target link");
  }
  result = read_regular_at(target_fd, target_name, expected, &target_stats);
  if (
    result != 0 ||
    target_stats.st_dev != source_stats.st_dev ||
    target_stats.st_ino != source_stats.st_ino ||
    target_stats.st_nlink < 2
  ) {
    saved_errno = errno;
    (void)unlinkat(target_fd, target_name, 0);
    errno = saved_errno;
    return result != 0 ? result : fail_message("target link identity is inconsistent");
  }
  if (unlinkat(source_fd, source_name, 0) != 0) {
    saved_errno = errno;
    (void)unlinkat(target_fd, target_name, 0);
    errno = saved_errno;
    return fail_errno("cannot remove no-replace source link");
  }
  if (fsync(source_fd) != 0 || fsync(target_fd) != 0) {
    return fail_errno("cannot durably synchronize moved file");
  }
  return 0;
}

static int run_move(int argc, char **argv, int reverse) {
  file_identity root_identity;
  file_identity source_identity;
  int root_fd = -1;
  int category_fd = -1;
  int result;
  char category_path[MAXPATHLEN];
  if (argc != 13) return fail_message("invalid move arguments");
  if (!is_single_component(argv[7]) || !is_category(argv[8]) || !is_single_component(argv[9])) {
    return fail_message("move paths must use allowed single components");
  }
  if (!parse_identity(argv[3], argv[4], "0", argv[5], &root_identity)) {
    return fail_message("invalid root identity");
  }
  if (!parse_identity(argv[10], argv[11], argv[12], argv[6], &source_identity)) {
    return fail_message("invalid source identity");
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
  maybe_signal_test_ready();
  maybe_test_delay();
  result = verify_directories(root_fd, argv[2], category_fd, category_path);
  if (result != 0) goto done;
  result = reverse
    ? move_between_directories(
        category_fd, argv[7], root_fd, argv[9], &source_identity
      )
    : move_between_directories(
        root_fd, argv[7], category_fd, argv[9], &source_identity
      );
done:
  if (category_fd >= 0) close(category_fd);
  if (root_fd >= 0) close(root_fd);
  if (result == 0) puts("{\"ok\":true}");
  return result;
}

static int run_remove_duplicate(int argc, char **argv) {
  file_identity root_identity;
  file_identity expected;
  struct stat root_file;
  struct stat category_file;
  int root_fd = -1;
  int category_fd = -1;
  int result;
  char category_path[MAXPATHLEN];
  if (argc != 13) return fail_message("invalid remove-duplicate arguments");
  if (!is_single_component(argv[7]) || !is_category(argv[8]) || !is_single_component(argv[9])) {
    return fail_message("duplicate paths must use allowed single components");
  }
  if (!parse_identity(argv[3], argv[4], "0", argv[5], &root_identity)) {
    return fail_message("invalid root identity");
  }
  if (!parse_identity(argv[10], argv[11], argv[12], argv[6], &expected)) {
    return fail_message("invalid duplicate identity");
  }
  result = open_root(argv[2], &root_identity, &root_fd);
  if (result != 0) goto done;
  result = open_child_directory(
    root_fd, argv[2], argv[8], 0, &category_fd, category_path
  );
  if (result != 0) goto done;
  maybe_signal_test_ready();
  maybe_test_delay();
  result = verify_directories(root_fd, argv[2], category_fd, category_path);
  if (result != 0) goto done;
  result = read_regular_at(root_fd, argv[7], &expected, &root_file);
  if (result != 0) goto done;
  result = read_regular_at(category_fd, argv[9], &expected, &category_file);
  if (result != 0) goto done;
  if (
    root_file.st_dev != category_file.st_dev ||
    root_file.st_ino != category_file.st_ino
  ) {
    result = fail_message("duplicate links do not share one inode");
    goto done;
  }
  if (unlinkat(category_fd, argv[9], 0) != 0 || fsync(category_fd) != 0) {
    result = fail_errno("cannot remove duplicate category link");
    goto done;
  }
done:
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
  if (append) {
    if (fstat(output_fd, &opened_stats) != 0) {
      result = fail_errno("cannot inspect opened transaction log");
      goto done;
    }
    if (
      !S_ISREG(opened_stats.st_mode) ||
      opened_stats.st_nlink != 1 ||
      !stat_matches(&opened_stats, &expected_log)
    ) {
      result = fail_message("opened transaction log identity changed");
      goto done;
    }
  }
  maybe_signal_test_ready();
  maybe_test_delay();
  result = verify_directories(root_fd, argv[2], log_fd, log_path);
  if (result != 0) goto done;
  if (append) {
    result = read_regular_at(log_fd, final_name, &expected_log, &path_stats);
    if (result != 0) goto done;
    if (
      path_stats.st_dev != opened_stats.st_dev ||
      path_stats.st_ino != opened_stats.st_ino
    ) {
      result = fail_message("transaction log path no longer names the opened file");
      goto done;
    }
  }
  result = write_all(output_fd, body, body_length);
  if (result != 0 || fsync(output_fd) != 0) {
    if (result == 0) result = fail_errno("cannot synchronize transaction log");
    goto done;
  }
  if (fstat(output_fd, &final_stats) != 0) {
    result = fail_errno("cannot inspect written transaction log");
    goto done;
  }
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
  print_identity(&final_stats);
done:
  saved_errno = errno;
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
  if (strcmp(argv[1], "remove-category-duplicate") == 0) {
    return run_remove_duplicate(argc, argv);
  }
  if (strcmp(argv[1], "log-create") == 0) {
    return run_log(argc, argv, 0);
  }
  if (strcmp(argv[1], "log-append") == 0) {
    return run_log(argc, argv, 1);
  }
  return fail_message("unknown command");
}
