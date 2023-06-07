const { task, logger, fs, setGlobalOptions } = require('foy')
const path = require('path');

setGlobalOptions({ loading: false }) 

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

  const batchPath = path.posix.join(cwd, "express.batch");
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