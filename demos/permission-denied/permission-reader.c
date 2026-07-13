#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: permission-reader FILE\n");
        return 64;
    }

    int descriptor = open(argv[1], O_RDONLY);
    if (descriptor < 0) {
        fprintf(stderr, "permission-reader: cannot open %s: %s\n", argv[1], strerror(errno));
        return errno == EACCES ? 77 : 1;
    }

    char buffer[256];
    ssize_t count = read(descriptor, buffer, sizeof(buffer));
    if (count < 0) {
        fprintf(stderr, "permission-reader: cannot read %s: %s\n", argv[1], strerror(errno));
        close(descriptor);
        return 74;
    }
    close(descriptor);
    if (count > 0 && write(STDOUT_FILENO, buffer, (size_t)count) != count) return 74;
    return 0;
}
