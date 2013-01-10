/*
 *  part.js
 *
 */

// export Part class
module.exports = Part

var util = require('util')
var Transformer = require('./transformer')

function Part (opts) {
  Transformer.call(this, opts)
  this.name = null
  this.filename = null
  this.headers = {}
  this.loaded = 0
}
util.inherits(Part, Transformer)

Part.prototype._transform = function (chunk, out, cb) {
  this.loaded += chunk.length
  this.emit('progress', this.loaded)
  cb(null, chunk)
}
