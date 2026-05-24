import { Spinner } from '../src/cli/ui';

async function test() {
  console.log('process.stdout.isTTY:', process.stdout.isTTY);
  const spinner = new Spinner('Initializing...');
  spinner.start();

  await new Promise(resolve => setTimeout(resolve, 1000));
  spinner.update('Fetching data...');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  spinner.update('Processing...');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  spinner.stop('Done!', true);

  const spinner2 = new Spinner('Failing task...');
  spinner2.start();
  await new Promise(resolve => setTimeout(resolve, 1000));
  spinner2.stop('Failed miserably', false);
}

test().catch(console.error);
