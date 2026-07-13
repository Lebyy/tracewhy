.PHONY: all clean
all: build/demo good/libdemo.so

build/demo: demo.c good/libdemo.so
	mkdir -p build
	$(CC) demo.c -Lgood -ldemo -Wl,-rpath,'$$ORIGIN/../good' -o build/demo

good/libdemo.so: libdemo.c
	mkdir -p good bad
	$(CC) -shared -fPIC libdemo.c -o good/libdemo.so

clean:
	rm -rf build good/libdemo.so .tracewhy
