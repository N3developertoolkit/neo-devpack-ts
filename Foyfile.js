const { task, logger   } = require('foy')
const path = require('path');

task('setup', async ctx => {
  await ctx.exec('npm install');
  await ctx.exec('dotnet tool restore');
});

task('build', async ctx => {
  await ctx.exec('tsc --build tsconfig.json');
})

task('clean', async ctx => {
  await ctx.exec('tsc --build tsconfig.json --clean');
  await ctx.exec('git clean -dxf', { cwd: './samples' });
})

const samples = ["helloworld", "nep11token", "nep17token", "registrar"];

async function buildSample(ctx, sample) {
  const cwd = path.join(__dirname, "samples", sample);
  const compilerPath = path.posix.join(__dirname, "packages/compiler/lib/main.js").replace(/\\/g, '/');
  await ctx.exec(`node ${compilerPath} ${sample}.ts -o ./out`, { cwd });
}

samples.forEach(sample => {
  task(sample, ['build'], async ctx => {
    await buildSample(ctx, sample);
  })
})

task('samples', ['build'], async ctx => {
  for (const sample of samples) {
    logger.warn(`Building ${sample}...`);
    await buildSample(ctx, sample);
  }
})