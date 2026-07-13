#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

enum { EX_DATAERR = 65, EX_CONFIG = 78 };

int main(int argc, char **argv) {
    if (argc != 2) {
        fputs("usage: config-preflight CONFIG\n", stderr);
        return EX_CONFIG;
    }

    int descriptor = open(argv[1], O_RDONLY | O_CLOEXEC);
    if (descriptor == -1) {
        fprintf(stderr, "config-preflight: cannot open %s: %s\n", argv[1], strerror(errno));
        return EX_CONFIG;
    }

    char contents[512];
    ssize_t length = read(descriptor, contents, sizeof(contents) - 1);
    int read_error = errno;
    close(descriptor);
    if (length < 0) {
        fprintf(stderr, "config-preflight: cannot read %s: %s\n", argv[1], strerror(read_error));
        return EX_DATAERR;
    }
    contents[length] = '\0';
    if (strstr(contents, "queue =") == NULL || strstr(contents, "concurrency =") == NULL) {
        fprintf(stderr, "config-preflight: %s is missing required settings\n", argv[1]);
        return EX_DATAERR;
    }

    puts("config-preflight: configuration accepted");
    return 0;
}
