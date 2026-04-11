#!/bin/sh
# wrapper to sanitize environment for C++ compiler
unset CXXFLAGS CFLAGS
exec /usr/bin/clang++ "$@"
