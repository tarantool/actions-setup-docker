const exec = require('@actions/exec');
const core = require('@actions/core');
const os = require('os');

const DOCKER_VERSION = core.getInput('docker_version');
const DOCKER_CHANNEL = core.getInput('docker_channel');
const DOCKER_CLI_EXPERIMENTAL = core.getInput('docker_cli_experimental');
const DOCKER_DAEMON_JSON = core.getInput('docker_daemon_json');
const DOCKER_BUILDX = core.getInput('docker_buildx');
const DOCKER_NIGHTLY_VERSION = core.getInput('docker_nightly_version');

const systemExec = require('child_process').exec;

let message;

async function shell(cmd) {
  return await new Promise((resolve, reject) => {
    systemExec(cmd, function (error, stdout, stderr) {
      if (error) {
        reject(error);
      }

      if (stderr) {
        reject(stderr);
      }

      resolve(stdout.trim());
    });
  });
}

async function buildx() {
  core.debug('set DOCKER_CLI_EXPERIMENTAL');
  if (DOCKER_CLI_EXPERIMENTAL === 'enabled') {
    core.exportVariable('DOCKER_CLI_EXPERIMENTAL', 'enabled');
  }

  if (DOCKER_BUILDX !== 'true') {
    core.info('buildx disabled');

    return;
  }

  core.exportVariable('DOCKER_CLI_EXPERIMENTAL', 'enabled');

  await exec.exec('docker', [
    'buildx',
    'version',
  ]).then(async () => {
    // install buildx
    core.startGroup('setup qemu');
    await exec.exec('docker', [
      'run',
      '--rm',
      '--privileged',
      'ghcr.io/dpsigs/tonistiigi-binfmt:latest',
      "--install",
      "all"
    ]);
    core.endGroup();

    core.startGroup('list /proc/sys/fs/binfmt_misc');
    await exec.exec('ls -la', [
      '/proc/sys/fs/binfmt_misc',
    ]).catch(() => { });
    core.endGroup();

    core.startGroup('create buildx instance');
    await exec.exec('docker', [
      'buildx',
      'create',
      '--use',
      '--name',
      'mybuilder',
      '--driver',
      'docker-container',
      '--driver-opt',
      // 'image=moby/buildkit:master'
      // moby/buildkit:buildx-stable-1
      'image=ghcr.io/dpsigs/moby-buildkit:master'
      // $ docker pull moby/buildkit:master
      // $ docker tag moby/buildkit:master ghcr.io/dpsigs/moby-buildkit:master
      // $ docker push ghcr.io/dpsigs/moby-buildkit:master
    ]);
    core.endGroup();

    core.startGroup('inspect buildx instance');
    await exec.exec('docker', [
      'buildx',
      'inspect',
      '--bootstrap'
    ]);
    core.endGroup();
  }, () => {
    core.info('this docker version NOT Support Buildx');
  });
}

async function run() {
  const platform = os.platform();

  if (platform === 'win32') {
    core.debug('check platform');
    await exec.exec('echo',
      [`::error::Only Support Linux and macOS platform, this platform is ${os.platform()}`]);

    return
  }

  if (platform === 'darwin') {
    // macos
    if (os.arch() !== 'x64') {
      core.warning('only support macOS x86_64, os arch is ' + os.arch());

      return;
    }

    core.exportVariable('DOCKER_CONFIG', '/Users/runner/.docker');

    await exec.exec('docker', [
      '--version']).catch(() => { });

    await exec.exec('docker-compose', [
      '--version']).catch(() => { });

    core.startGroup('install docker')

    await exec.exec('brew', [
      'reinstall',
      // DOCKER_CHANNEL !== 'stable' ? 'docker' : 'docker',
      'docker',
    ]);

    await exec.exec('brew', [
      'link',
      '--overwrite',
      'docker'
    ]);

    core.endGroup();

    await exec.exec('mkdir', [
      '-p',
      '/Users/runner/.docker'
    ]);

    await shell(`echo '${DOCKER_DAEMON_JSON}' | sudo tee /Users/runner/.docker/daemon.json`);

    core.startGroup('show daemon json content');

    await exec.exec('cat', [
      '/Users/runner/.docker/daemon.json',
    ]);
    core.endGroup();

    core.startGroup('wait docker running');
    await exec.exec('brew', [
      'install',
      'colima'
    ]);
    await exec.exec('colima', [
      'start'
    ]);

    await exec.exec('echo', [
      '$HOME'
    ]);

    await exec.exec('sudo', [
      'rm',
      '/var/run/docker.sock'
    ]);


    await exec.exec('ls', [
      '/var/run/'
    ]);

    await exec.exec('sudo', [
      'ln',
      '-sf',
      '/Users/tntmac03.tarantool.i/.colima/default/docker.sock',
      '/var/run/docker.sock'
    ]);

    await exec.exec('ls', [
      '/var/run/'
    ]);

    core.endGroup();

    await core.group('set up buildx', buildx);

    return
  }

  message = 'check docker systemd status';
  core.startGroup(message)
  await exec.exec('sudo', [
    'systemctl',
    'status',
    'docker',
  ]).then(() => { }).catch(() => { });
  core.endGroup();

  message = 'check docker version'
  core.debug(message);
  core.startGroup(message);
  await exec.exec('docker', [
    'version',
  ]).catch(() => { });
  core.endGroup();

  if (DOCKER_CHANNEL === 'nightly') {
    if (os.arch() !== 'x64') {
      core.warning('nightly version only support x86_64, os arch is ' + os.arch());

      return;
    }

    core.exportVariable('DOCKER_CONFIG', '/home/runner/.docker');

    core.startGroup('download deb');
    await exec.exec('curl', [
      '-fsSL',
      '-o',
      '/tmp/moby-snapshot-ubuntu-focal-x86_64-deb.tbz',
      `https://github.com/AkihiroSuda/moby-snapshot/releases/download/${DOCKER_NIGHTLY_VERSION}/moby-snapshot-ubuntu-focal-x86_64-deb.tbz`
    ]);
    core.endGroup();

    await exec.exec('sudo', [
      'rm',
      '-rf',
      '/tmp/*.deb'
    ]);

    core.startGroup('unpack tbz file');
    await exec.exec('tar', [
      'xjvf',
      '/tmp/moby-snapshot-ubuntu-focal-x86_64-deb.tbz',
      '-C',
      '/tmp'
    ]);
    core.endGroup();

    core.startGroup('remove default moby');
    await exec.exec('sudo', [
      'sh',
      '-c',
      "apt remove -y moby-buildx moby-cli moby-compose moby-containerd moby-engine moby-runc"
    ]).catch(() => { });
    core.endGroup();

    core.startGroup('update apt cache');
    await exec.exec('sudo', [
      'apt-get',
      'update',
    ]).catch(() => { });
    core.endGroup();

    core.startGroup('install docker');
    await exec.exec('sudo', [
      'sh',
      '-c',
      'apt-get install -y /tmp/*.deb'
    ]).catch(async () => {
      core.endGroup();

      core.startGroup('install docker');
      await exec.exec('sudo', [
        'sh',
        '-c',
        'dpkg -i /tmp/*.deb'
      ]);
      core.endGroup();
    });
    core.endGroup();

  } else {
    core.exportVariable('DOCKER_CONFIG', '/home/runner/.docker');

    core.debug('add apt-key');
    await shell(`
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor | sudo cat >/usr/share/keyrings/docker-archive-keyring.gpg
    `);

    message = 'add apt source';
    core.debug(message);
    const UBUNTU_CODENAME = await shell('lsb_release -cs');
    core.startGroup(message);
    await shell(`
    echo \
      "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
      ${UBUNTU_CODENAME} ${DOCKER_CHANNEL}" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    `)
    core.endGroup();

    message = 'update apt cache'
    core.debug(message);
    core.startGroup(message);
    await exec.exec('sudo', [
      'apt-get',
      'update',
    ]).catch(() => { });
    core.endGroup();

    message = 'show available docker version';
    core.debug(message);
    core.startGroup(message);
    await exec.exec('apt-cache', [
      'madison',
      'docker-ce',
      '|',
      'grep',
      '20.10'
    ]);
    core.endGroup()

    const DOCKER_VERSION_STRING = await shell(
      `apt-cache madison docker-ce | grep ${DOCKER_VERSION} | head -n 1 | awk '{print $3}' | sed s/[[:space:]]//g`)

    if (!DOCKER_VERSION_STRING) {
      const OS = await shell(
        `cat /etc/os-release | grep VERSION_ID | cut -d '=' -f 2`
      );

      core.warning(`Docker ${DOCKER_VERSION} not available on ubuntu ${OS}, will install latest docker version`);
    }

    core.startGroup('remove default moby');
    await exec.exec('sudo', [
      'sh',
      '-c',
      "apt remove -y moby-buildx moby-cli moby-compose moby-containerd moby-engine moby-runc"
    ]).catch(() => { });
    core.endGroup();

    message = 'install docker'
    core.debug(message);
    core.startGroup(message);
    await exec.exec('sudo', [
      'apt-get',
      '-y',
      'install',
      DOCKER_VERSION_STRING ? `docker-ce=${DOCKER_VERSION_STRING}` : 'docker-ce',
      DOCKER_VERSION_STRING ? `docker-ce-cli=${DOCKER_VERSION_STRING}` : 'docker-ce-cli'
    ]);

    await exec.exec('sudo', [
      'apt-get',
      '-y',
      'install',
      'docker-compose-plugin',
    ]).catch(() => { });
    core.endGroup();
  }

  message = 'check docker version';
  core.debug(message);
  core.startGroup(message);
  await exec.exec('docker', [
    'version',
  ]);
  core.endGroup();

  message = 'check docker systemd status';
  core.debug(message);
  core.startGroup(message);
  await exec.exec('sudo', [
    'systemctl',
    'status',
    'docker',
  ]);
  core.endGroup();

  // /etc/docker/daemon.json
  core.debug('set /etc/docker/daemon.json');
  core.startGroup('show default daemon json content');
  await exec.exec('sudo', [
    'cat',
    '/etc/docker/daemon.json',
  ]);
  core.endGroup();

  await shell(`echo '${DOCKER_DAEMON_JSON}' | sudo tee /etc/docker/daemon.json`);

  core.startGroup('show daemon json content');
  await exec.exec('sudo', [
    'cat',
    '/etc/docker/daemon.json',
  ]);
  core.endGroup();

  await exec.exec('sudo', [
    'systemctl',
    'restart',
    'docker',
  ]);

  await core.group('set up buildx', buildx);

  core.startGroup('docker info');
  await exec.exec('docker', ['info']);
  core.endGroup();
}

run().then(() => {
  console.log('Run success');
}).catch((e) => {
  core.setFailed(e.toString());
});
