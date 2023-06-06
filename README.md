# neo-devpack-ts

*under active development*

## Requirements

* [NodeJS](https://nodejs.org/) 18+
  * The developer is using NodeJS LTS version
* [Neo-Express requirements](https://github.com/neo-project/neo-express#requirements) (for testing)

## Usage

* `npm run setup`: installs package dependencies + NeoExpress as local tool
* `npm run build`: compiles the devpack
* `npm run compile`: runs the compiler to compile the hard coded test contract
* `npm run clean`: cleans the build output

> Note, at this stage of development, the input contract file is hard coded to the sample NEP-17 contract in source.
> To test the TS-Devpack compiler with a different contract, please update the FILENAME variable in [main.ts](packages/compiler/src/main.ts)
