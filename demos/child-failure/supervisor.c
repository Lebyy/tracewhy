#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: supervisor CHILD\n");
        return 64;
    }

    pid_t child = fork();
    if (child < 0) {
        fprintf(stderr, "supervisor: fork failed: %s\n", strerror(errno));
        return 71;
    }
    if (child == 0) {
        char *const child_argv[] = {argv[1], NULL};
        execv(argv[1], child_argv);
        fprintf(stderr, "supervisor: cannot execute %s: %s\n", argv[1], strerror(errno));
        _exit(126);
    }

    int status = 0;
    if (waitpid(child, &status, 0) < 0) {
        fprintf(stderr, "supervisor: wait failed: %s\n", strerror(errno));
        return 71;
    }
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 70;
}
