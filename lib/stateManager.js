const colors = require('colors'),
      debug = require('debug')('popy:StateManager');

const STATE = require('./constants').STATE

function StateManager(client) {
  this.client = client
}

const proto = StateManager.prototype

/**
 * Handle data
 * @param  {Buffer} data
 * @return {Void}
 */
proto.handle = function(data, callback) {
  const client = this.client
  if (!client) {
    throw new Error('Please initialize the Client')
  }
  if (isErr(data)) {
    return client.emit('error', data.toString().slice('-ERR'.length))
  }
  if (!client.connected) { //unconnected
    switch (client.state) {
      case STATE.NOOP:
        client.cmds.runCommand('USER', client.username)
        break;
      case STATE.USER:
        client.cmds.runCommand('PASS', client.password)
        break;
      case STATE.PASS:
        client.connected = true
        client.state = STATE.NOOP
        debug(colors.green('auth success'))
        if (typeof callback === 'function') {
          callback()
        }
        client.cmds.runBatch()
        break;
    }
    return
  }
  // connected
  if (!!~[STATE.RETR, STATE.TOP, STATE.LIST].indexOf(client.state)) {
    if (typeof client.data === 'undefined') {
      client.data = data
      return
    } else {
      client.data = Buffer.concat([client.data, data])
      // debug('last:', client.data.slice(client.data.length - 5))
      if (client.data.slice(client.data.length - 5).toString() !== '\r\n.\r\n') {
        return
      }
    }
  }
  if (client.state === STATE.QUIT) {
    client.connected = false
  }
  const cb = client.callbacks.shift()
  if (typeof cb === 'function') {
    if (!!~[STATE.RETR].indexOf(client.state)) {
      const simpleParser = require('mailparser-node4').simpleParser
      return simpleParser(client.data, (err, mail) => {
        if (err) {
          debug(color.red('simpleParser error:' + err))
          cb(null)
        } else {
          cb(mail)
        }
        delete client.data
        client.cmds.runBatch()
      })
    }
    client.state = STATE.NOOP
    cb(data.toString())
  }
  client.cmds.runBatch()
}

/**
 * Validate data
 * @param  {Buffer}  data
 * @return {Boolean}      [description]
 */
function isErr(data) {
  return !!~(data ? data.toString() : '-ERR').indexOf('-ERR')
}

module.exports = StateManager
