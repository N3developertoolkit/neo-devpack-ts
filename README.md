# neo-devpack-ts

*under active development*

## Requirements

* [NodeJS](https://nodejs.org/) 18+
  * The developer is using NodeJS LTS version
* [pnpm](https://pnpm.io/)
  * The developer is using NPM based install: `npm install -g pnpm`
* Neo-Express (for testing)

## Usage

* `npm run config`: installs package dependencies + NeoExpress as local tool
* `npm run build`: compiles the devpack
* `npm run run`: runs the compiler to compile the NEP-17 test contract
* `npm run neoxp-batch`: runs the test NeoExpress batch file to deploy and use the NEP-17 test contract
* `npm run all`: run all four scripts above

> Note, at this stage of development, the input contract file is hard coded to the sample NEP-17 contract in source.
> To test the TS-Devpack compiler with a different contract, please update the FILENAME variable in [main.ts](packages/compiler/src/main.ts)
