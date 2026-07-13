#include <errno.h>
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    const char *value = getenv("TRACEWHY_DEMO_CHILD_EXIT");
    if (value == NULL) return 64;

    errno = 0;
    char *end = NULL;
    long status = strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || status < 0 || status > 125) return 64;
    if (status == 0) {
        puts("child-worker: completed");
    } else {
        fprintf(stderr, "child-worker: failed with exit %ld\n", status);
    }
    return (int)status;
}
