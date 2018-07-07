const net = require('net'),
      tls = require('tls'),
      util = require('util'),
      EventEmitter = require('events');

const kvo = require('kvo').kvo,
      colors = require('colors'),
      debug = require('debug')('popy:client');

const STATE = require('./constants').STATE,
      StateManager = require('./StateManager'),
      Cmd = require('./cmd');

function init(context, opts) {
  ['username', 'password', 'host', 'port', 'tls'].forEach(function(attr, i) {
    context[attr] = kvo(opts, attr)
  })
}

function Client(opts) {
  init(this, opts)
  this.connected = false
  this.state = STATE.NOOP
  this.callbacks = []
  this.cmds = new Cmd(this)
  this._socket = (this.tls ? tls : net).connect({host: this.host, port: this.port, rejectUnauthorized: false}, () => {
    debug(colors.green('Connect to server and waiting for auth'))
  })
  this._socket.on('data', (data) => new StateManager(this).handle(data))

  this._socket.on('end', () => {
    debug('end')
  })

  this._socket.on('error', (error) => {
    console.error(colors.red('onError:' + error))
    this.emit('error', error)
  })

  this.init()
}

Client.prototype = {
  init: function() {
    ['stat', 'retr', 'list', 'dele', 'quit', 'rset', 'top'].reduce((memo, attr)=>{
      memo[attr] = function() {
        const args = Array.prototype.slice.call(arguments, 0)
        const lastArg = args[args.length - 1]
        const isCb = typeof lastArg === 'function'
        if (!isCb) {
          lastArg = function() {}
          args.push(lastArg)
        }
        this.cmds.cmd.apply(this.cmds, [attr.toUpperCase()].concat(args.slice(0, args.length - 1)))
        addCallback.call(this, lastArg)
      }
      return memo
    }, this)
  }
}

util.inherits(Client, EventEmitter)

function addCallback(callback) {
  this.callbacks.push(callback)
  if (this.connected) {
    this.cmds.runBatch(this._socket)
  }
}

module.exports = Client
