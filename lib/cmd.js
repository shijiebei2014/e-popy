const debug = require('debug')('popy:cmd')
const STATE = require('./constants').STATE

function Cmd(client) {
  this.queues = []
  this.client = client
}

Cmd.prototype = {
  run: function (cmdString) {
    this.client._socket.write(cmdString)
  },
  cmd: function(cmd, args) {
    this.queues.push(`${cmd}${args ? ' ' + args : ''}\r\n`)
  },
  runCommand: function(cmd, args) {
    const cmdString = `${cmd}${args ? ' ' + args : ''}\r\n`
    this.client.state = STATE[cmd]
    this.run(cmdString)
  },
  runBatch: function() {
    if (this.queues.length) {
      const cmdString = this.queues.shift()
      debug(cmdString)
      this.client.state = STATE[cmdString.replace(/\r\n/g, ' ').split(' ')[0]]
      this.run(cmdString)
    }
  }
}

module.exports = Cmd;
