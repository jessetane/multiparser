/*
 *  transformer.js
 *
 */

// export Transformer class
module.exports = Transformer

var util = require('util')
var stream = require('stream')

function Transformer (opts) {
  stream.Duplex.call(this, opts)
  this._buffer = []
  this.once('finish', this.done.bind(this))
}
util.inherits(Transformer, stream.Duplex)

Transformer.prototype._write = function (chunk, cb) {
  var self = this
  var rs = this._readableState
  function push (err, chunk) {
    var ret = self.push(chunk)
    if (rs.length && rs.needReadable) {
      self.emit('readable')
    }
    if (!ret) {
      self._buffer.push(cb)
    } else {
      cb()
    }
  }
  if (this._transform) {
    this._transform(chunk, null, push)
  } else {
    push(null, chunk)
  }
}

Transformer.prototype._read = function (n, cb) {
  while (this._buffer.length) {
    this._buffer.shift()()
  }
}

Transformer.prototype.done = function () {
  var rs = this._readableState
  rs.ended = true
  if (rs.length && rs.needReadable) {
    this.emit('readable')
  } else if (rs.length === 0) {
    this.emit('end')
  }
}
