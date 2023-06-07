# neo-devpack-ts

> Note, this project is under active development. It is not yet packaged as a stand alone tool.
> If you wish to try it with your own contract, please see the [Samples](#samples) section below.

## Requirements

* [NodeJS](https://nodejs.org/) 18+
  * The developer is using NodeJS LTS version
* [Neo-Express requirements](https://github.com/neo-project/neo-express#requirements) (for testing)

## Usage

* `npm run setup`: installs package dependencies + NeoExpress as local tool
* `npm run build`: compiles the devpack
* `npm run clean`: cleans the build output
* `npm run samples`: compiles the devpack and builds the sample contracts
* `npx foy <sample name>`: builds the specified sample contract and runs the associated express.batch file if available

## Samples

The `foy` task runner dynamically generates the samples to build from the contents of the `samples` directory. 
Any subdirectory of `samples` that doesn't start with an underscore is considered a sample.
Each sample directory must contain a contract `.ts` file matching the name of the directory.
If the sample directory contains an `express.batch` file, it will be run automatically after the contract is built.

### Hello World

Simple contract that stores a byte string in contract storage and returns it when called.

### Tank NEP-17 Token

Implements a sample [NEP-17](https://github.com/neo-project/proposals/blob/master/nep-17.mediawiki) fungible token contract

### Hovercraft NEP-11 Token

Implements a sample [NEP-11](https://github.com/neo-project/proposals/blob/master/nep-11.mediawiki) non fungible token contract

