#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    int descriptor = open("config.json", O_RDONLY);
    if (descriptor < 0) {
        fprintf(stderr, "config-reader: cannot open config.json: %s\n", strerror(errno));
        return errno == ENOENT ? 78 : 1;
    }

    char buffer[256];
    ssize_t count = read(descriptor, buffer, sizeof(buffer));
    if (count < 0) {
        fprintf(stderr, "config-reader: cannot read config.json: %s\n", strerror(errno));
        close(descriptor);
        return 74;
    }
    close(descriptor);
    if (count > 0 && write(STDOUT_FILENO, buffer, (size_t)count) != count) return 74;
    return 0;
}
