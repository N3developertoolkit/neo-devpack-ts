const { task, logger, fs, setGlobalOptions } = require('foy')
const path = require('path');
var nbgv = require('nerdbank-gitversioning')

setGlobalOptions({ loading: false }) 

// build a list of all the samples from the samples directory
const sampleDir = path.posix.join(__dirname, "samples")
const samples = fs.readdirSync(sampleDir)
  .filter(x => !x.startsWith("_"))
  .map(x => path.join(sampleDir, x))
  .filter(x => fs.statSync(x).isDirectory())
  .map(x => path.basename(x))


task('setversion', async ctx => {
  const compilerPath = path.join(__dirname, "packages", "compiler")
  const fxPath = path.join(__dirname, "packages", "framework")

  await nbgv.setPackageVersion(__dirname);
  await nbgv.setPackageVersion(compilerPath);
  await nbgv.setPackageVersion(fxPath);
})

task('build', async ctx => {
  const version = await nbgv.getVersion();
  logger.info(`Version: ${version.version}`);
  await ctx.exec('tsc --build tsconfig.json', { cwd: __dirname });
})

task('clean', async ctx => {
  await ctx.exec('tsc --build tsconfig.json --clean', { cwd: __dirname });
  await ctx.exec('git clean -dxf', { cwd: path.join(__dirname, "samples") });
})

async function buildSample(ctx, sample) {
  const cwd = path.join(__dirname, "samples", sample);
  const compilerPath = path.posix.join(__dirname, "packages/compiler/lib/main.js").replace(/\\/g, '/');
  await ctx.exec(`node ${compilerPath} ${sample}.ts -o ./out`, { cwd });

  const batchPath = path.join(cwd, "express.batch");
  if (fs.existsSync(batchPath)) {
    await ctx.exec(`dotnet neoxp batch -r express.batch`, { cwd });
  }
}

samples.forEach(sample => {
  task(sample, ['build'], async ctx => {
    await buildSample(ctx, sample);
  })
})

task('samples', ['build'], async ctx => {
  for (const sample of samples) {
    await buildSample(ctx, sample);
  }
})