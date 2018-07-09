const net = require('net')
const tls = require('tls')
const util = require('util')
const EventEmitter = require('events')

const kvo = require('kvo').kvo
const colors = require('colors')
const async = require('async')
const debug = require('debug')('popy:client')

const STATE = require('./constants').STATE
const StateManager = require('./StateManager')
const Cmd = require('./cmd')

function init(context, opts) {
  ['username', 'password', 'host', 'port', 'tls', 'timeout', 'mailparser'].forEach(function(attr, i) {
    context[attr] = kvo(opts, attr)
  })

  const methods = ['stat', 'retr', 'list', 'dele', 'quit', 'rset', 'top']
  for(var i = 0; i < methods.length; i++) {
    (function(i) {
      var attr = methods[i]

      context[attr] = function() {
        const args = Array.prototype.slice.call(arguments, 0)
        const lastArg = args[args.length - 1]
        const isCb = typeof lastArg === 'function'
        if (!isCb) {
          lastArg = function() {}
          args.push(lastArg)
        }
        context.cmds.cmd.apply(context.cmds, [attr.toUpperCase()].concat(args.slice(0, args.length - 1)))
        addCallback.call(context, lastArg)
      }
    })(i)
  }
}

function Client(opts) {
  EventEmitter.call(this)

  this.connected = false
  this.state = STATE.NOOP
  this.callbacks = []
  this.cmds = new Cmd(this)
  init(this, opts)
  if (this.timeout === undefined) { //超时时间
    this.timeout = 1000 * 30
  }
  this._socket = null
}

util.inherits(Client, EventEmitter)

const proto = Client.prototype

const wrapOneParamCb = function(cb) {
  return function(data) {
    cb(null, data)
  }
}

const wrapFinCb = function(cb, context) {
  return function(err, data) {
    if (err) {
      return context.emit('error', err)
    }
    cb(data)
  }
}

const deleteHelper = function(opts, cb) {
  const self = this
  const isDele = kvo(opts, 'dele')
  const isAll = kvo(opts, 'all')
  const num = kvo(opts, 'num')

  async.waterfall([
    function(done) {
      if (isAll) {
          self.count(wrapOneParamCb(done))
      } else {
        done(null, Array.isArray(num) ? num : [num])
      }
    },
    function(cnt, done) {
      const arr = Array.isArray(cnt) ? cnt : null
      async.timesSeries((Array.isArray(cnt) ? cnt.length : cnt), function(n, next) {
        self.dele(arr ? arr[n] : n + 1, wrapOneParamCb(next))
      }, function(err) {
        if (err) {
          return done(err)
        }
        if (isDele) {
          return self.quit(wrapOneParamCb(done))
        }
        done(null, 'mark delete success')
      })
    }
  ], wrapFinCb(cb, self))
}

const retrieveAndDeleteHelper = function(opts, cb) {
  const self = this
  // const isDele = kvo(opts, 'dele')
  const isAll = kvo(opts, 'all')
  const num = kvo(opts, 'num')

  async.waterfall([
    function(done) {
      if (isAll) {
          self.count(wrapOneParamCb(done))
      } else {
        done(null, Array.isArray(num) ? num : [num])
      }
    },
    function(cnt, done) {
      const arr = Array.isArray(cnt) ? cnt : null
      async.timesSeries((Array.isArray(cnt) ? cnt.length : cnt), function(n, next) {
        async.series({
          retr: function(callback) {
            self.retr(arr ? arr[n] : n + 1, wrapOneParamCb(callback))
          },
          dele: function(callback) {
            self.dele(arr ? arr[n] : n + 1, wrapOneParamCb(callback))
          }
        }, function(err, result) {
          if (err) {
            return next(err)
          }
          next(null, result.retr)
        })
      }, function(err, result) {
        if (err) {
          return done(err)
        }
        self.quit(function() {
          done(null, result)
        })
      })
    }
  ], wrapFinCb(cb, self))
}

proto.connect = function(cb) {
  if (this.connected) {
    if (typeof cb === 'function') {
      cb()
    }
    return
  }
  this._socket = (this.tls ? tls : net).connect({host: this.host, port: this.port, rejectUnauthorized: false}, () => {
    debug(colors.green('Connect to server and waiting for auth'))
  })
  // set connect timeout
  this._socket.setTimeout(this.timeout)
  this._socket.on('timeout', ()=> {
    this._socket.end()
    this.emit('error', 'timeout')
  })
  this._socket.on('data', (data) => new StateManager(this).handle(data, cb))
  this._socket.on('end', () => {
    debug('end')
  })
  this._socket.on('error', (error) => {
    console.error(colors.red('onError:' + error))
    this.emit('error', error)
  })
},

proto.disconnect = function(cb) {
  debug('connected:' + this.connected)
  this.quit(cb)
}

proto.listAll = function(cb) {
  this.list((data)=> {
    const ret = []
    data = data.substring('+OK\r\n'.length, data.indexOf('.')).replace(/\r\n/g, ',').trim().split(',')
    data.forEach((str, i)=> {
      const strs = str.split(' ')
      if (strs.length === 2) {
        ret.push({num: Number(strs[0]), size: Number(strs[1])})
      }
    })
    cb(ret)
  })
}

proto.count = function(cb) {
  this.listAll((data)=> {
    cb(data.length)
  })
}

proto.retrieve = function(nums, cb) {
  const self = this
  nums = Array.isArray(nums) ? nums : [nums]
  async.waterfall([
    function(done) {
      async.timesSeries(nums.length, function(n, next) {
        self.retr(nums[n], wrapOneParamCb(next))
      }, done)
    }
  ], wrapFinCb(cb, self))
}

proto.retrieveAll = function(cb) {
  const self = this
  async.waterfall([
    function(done) {
      self.count(wrapOneParamCb(done))
    },
    function(cnt, done) {
      async.timesSeries(cnt, function(n, next) {
        self.retr(n + 1, wrapOneParamCb(next))
      }, done)
    }
  ], wrapFinCb(cb, self))
}

proto.markDeleteAll = function(cb) {
  deleteHelper.call(this, {
    all: true
  }, cb)
}

proto.deleteAll = function(cb) {
  deleteHelper.call(this, {
    all: true,
    dele: true
  }, cb)
}

proto.delete = function(num, cb) {
  deleteHelper.call(this, {
    all: false,
    dele: true,
    num: [num]
  }, cb)
}

proto.retrieveAllAndDelete = function(cb) {
  retrieveAndDeleteHelper.call(this, {
    all: true,
  }, cb)
}

proto.retrieveAndDelete = function(num, cb) {
  retrieveAndDeleteHelper.call(this, {
    all: false,
    num: num
  }, cb)
}

function addCallback(callback) {
  this.callbacks.push(callback)
  if (this.connected) {
    this.cmds.runBatch(this._socket)
  }
}

module.exports = Client
