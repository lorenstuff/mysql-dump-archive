# Changelog
## 3.0.2

* fix: added prepublishOnly script

## 3.0.1

* refactor: removed tsconfig.json from .npmignore

## 3.0.0

* refactor: refactored and cleaned up code and exports

## 2.0.3
Fixed a bug where `getTableNames` did not close its connection to the database.

## 2.0.2
Fixing another mistake where `createArchive` was writing archives to the wrong path.

## 2.0.1
Fixing some mistakes in the `createArchive` function which caused it to not work at all.

## 2.0.0
Rewrote the entire thing to be a package.

This package is also now only responsible for dumping and archiving the database for you. You should write your own script to upload the archive to one (or ideally multiple) backup locations.

## 1.0.0
Initial release.