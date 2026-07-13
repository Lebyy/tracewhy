#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

enum { EX_USAGE = 64, EX_OSERR = 71, MAX_EXECUTABLE_PATH = 4096 };

int main(int argc, char **argv) {
    if (argc != 3 || strcmp(argv[1], "--config") != 0) {
        fputs("usage: media-worker --config FILE\n", stderr);
        return EX_USAGE;
    }

    char preflight[MAX_EXECUTABLE_PATH];
    const char *separator = strrchr(argv[0], '/');
    size_t directory_length = separator == NULL ? 0 : (size_t)(separator - argv[0] + 1);
    const char *executable = "config-preflight";
    if (directory_length + strlen(executable) >= sizeof(preflight)) {
        fputs("media-worker: executable path is too long\n", stderr);
        return EX_OSERR;
    }
    memcpy(preflight, argv[0], directory_length);
    strcpy(preflight + directory_length, executable);

    pid_t child = fork();
    if (child == -1) {
        fprintf(stderr, "media-worker: fork failed: %s\n", strerror(errno));
        return EX_OSERR;
    }
    if (child == 0) {
        execl(preflight, "config-preflight", argv[2], NULL);
        fprintf(stderr, "media-worker: cannot execute preflight: %s\n", strerror(errno));
        _exit(127);
    }

    int status;
    if (waitpid(child, &status, 0) == -1) {
        fprintf(stderr, "media-worker: wait failed: %s\n", strerror(errno));
        return EX_OSERR;
    }
    if (WIFSIGNALED(status)) {
        int signal = WTERMSIG(status);
        fprintf(stderr, "media-worker: preflight terminated by signal %d\n", signal);
        return 128 + signal;
    }
    if (!WIFEXITED(status)) {
        fputs("media-worker: preflight ended without an exit status\n", stderr);
        return EX_OSERR;
    }

    int exit_code = WEXITSTATUS(status);
    if (exit_code != 0) {
        fprintf(stderr, "media-worker: preflight failed with exit %d\n", exit_code);
        return exit_code;
    }

    puts("media-worker: ready to process thumbnail jobs");
    return 0;
}
