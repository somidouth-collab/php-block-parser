# php-block-parser
Lightweight multi-pass PHP parser written in TypeScript. Extracts namespaces, classes, interfaces, traits, enums, functions, methods, properties, constants, and closures without building a full AST. Designed for fast code intelligence, indexing, and editor tooling.

# PHP Block Parser

A lightweight PHP symbol parser written in TypeScript.

## Features

* Namespace extraction
* Class parsing
* Interface parsing
* Trait parsing
* Enum parsing
* Global function parsing
* Method parsing
* Property parsing
* Constant extraction
* Closure detection
* Multi-pass architecture
* No external dependencies

## Philosophy

PHP Block Parser focuses on speed and simplicity. Instead of building a complete Abstract Syntax Tree (AST), it performs ordered parsing passes to extract symbols useful for code intelligence features such as:

* Symbol indexing
* Go to definition
* Workspace navigation
* Auto completion
* Code analysis

## Author

Somi Douth

## License

MIT
