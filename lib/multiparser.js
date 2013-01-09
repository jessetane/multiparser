/*
 *  multiparser.js
 *
 */

// export Multiparser class
module.exports = Multiparser

var util = require('util'),
    stream = require('stream'),
    Part = require('./part'),
    s = 0,
    S = { 
      PARSER_UNINITIALIZED: s++,
      START: s++,
      START_BOUNDARY: s++,
      HEADER_FIELD_START: s++,
      HEADER_FIELD: s++,
      HEADER_VALUE_START: s++,
      HEADER_VALUE: s++,
      HEADER_VALUE_ALMOST_DONE: s++,
      HEADERS_ALMOST_DONE: s++,
      PART_DATA_START: s++,
      PART_DATA: s++,
      PART_END: s++,
      END: s++
    },
    f = 1,
    F = { 
      PART_BOUNDARY: f,
      LAST_BOUNDARY: f *= 2
    },
    LF = 10,
    CR = 13,
    SPACE = 32,
    HYPHEN = 45,
    COLON = 58,
    A = 97,
    Z = 122

for (s in S) {
  exports[s] = S[s]
}

function lower(c) {
  return c | 0x20
}

function stateToString(stateNumber) {
  for (var state in S) {
    var number = S[state]
    if (number === stateNumber) return state
  }
}

function Multiparser(request, opts) {
  var self = this
  stream.Writable.call(this, opts)
  
  this.parseHeaders(request.headers)
  if (this.type !== 'multipart') {
    this.emit('error', new Error('content-type is not \'multipart/form-data\''))
    return this.onEnd()
  } else if (!this.boundary) {
    this.emit('error', new Error('no suitable boundary found'))
    return this.onEnd()
  }
  
  this.parsedLength = 0
  this.flags = 0
  this.index = null
  this.markers = {}
  this.part = null
  this.activeParts = []
  this.endEmitted = false
  this.headerField = ''
  this.headerValue = ''
  this.state = S.START
  
  request.on('error', function (err) {
    var parts = self.activeParts.slice()
    for (var p in parts) {
      var part = parts[p]
      part.end()
    }
    this.emit('error', err)
    this.onEnd()
  })
  
  request.pipe(this, { chunkSize: this._writableState.highWaterMark })
}
util.inherits(Multiparser, stream.Writable)

Multiparser.prototype.parseHeaders = function (headers) {
  // length
  if (headers['content-length']) {
    this.length = parseInt(headers['content-length'])
  }
  
  // type & boundary
  if (headers['content-type'].match(/multipart/i)) {
    this.type = 'multipart'
    var boundary = headers['content-type'].match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (boundary) {
      boundary = boundary[1] || boundary[2]
      this.boundary = new Buffer(boundary.length+4);
      this.boundary.write('\r\n--', 'ascii', 0);
      this.boundary.write(boundary, 'ascii', 4);
      this.lookbehind = new Buffer(this.boundary.length + 8)
      this.boundaryChars = {}
      for (var i=0; i<this.boundary.length; i++) {
        this.boundaryChars[this.boundary[i]] = true
      }
    }
  }
}

Multiparser.prototype._write = function (buffer, cb) {
  this.parsedLength += buffer.length
  this.emit('progress', this.parsedLength, this.length)
  
  var self = this,
      prevIndex = this.index,
      index = this.index,
      state = this.state,
      flags = this.flags,
      boundary = this.boundary,
      lookbehind = this.lookbehind,
      boundaryChars = this.boundaryChars,
      boundaryLength = this.boundary.length,
      boundaryEnd = boundaryLength - 1,
      bufferLength = buffer.length,
      markers = this.markers,
      i = 0,
      cl,
      c
  
  function dataCallback (name, clear) {
    if (markers[name] === undefined) return
    if (!clear) {
      callback(name, buffer, markers[name], bufferLength)
      markers[name] = 0
    } else {
      callback(name, buffer, markers[name], i)
      delete markers[name]
    }
  }

  function callback (name, buffer, start, end) {
    var name = 'on' + name.slice(0, 1).toUpperCase() + name.slice(1)
    if (start !== undefined && start === end) return
    if (self[name]) {
      self[name](buffer, start, end, function (written) {
        if (cb && !written) {
          var wcb = cb
          cb = null
          self.part.once('drain', function () {
            wcb()
          })
        }
      })
    }
  }
  
  for (i=0; i<bufferLength; i++) {
    c = buffer[i]
    switch (state) {
      case S.PARSER_UNINITIALIZED:
        return i
      case S.START:
        // skip leading CR/LF
        if (c == CR || c == LF) {
          continue
        }
        index = 0
        state = S.START_BOUNDARY
      case S.START_BOUNDARY:
        if (index == boundary.length - 2) {
          if (c != CR) {
            return i
          }
          index++
          break
        } else if (index - 1 == boundary.length - 2) {
          if (c != LF) {
            return i
          }
          index = 0
          callback('partBegin')
          state = S.HEADER_FIELD_START
          break
        }
        if (c != boundary[index+2]) {
          return i
        }
        index++
        break
      case S.HEADER_FIELD_START:
        state = S.HEADER_FIELD
        markers['headerField'] = i
        index = 0
      case S.HEADER_FIELD:
        if (c == CR) {
          delete markers['headerField']
          state = S.HEADERS_ALMOST_DONE
          break
        }
        index++
        if (c == HYPHEN) {
          break
        }
        if (c == COLON) {
          if (index == 1) {
            // empty header field
            return i
          }
          dataCallback('headerField', true)
          state = S.HEADER_VALUE_START
          break
        }
        cl = lower(c)
        if (cl < A || cl > Z) {
          return i
        }
        break
      case S.HEADER_VALUE_START:
        if (c == SPACE) {
          break
        }
        this.markers['headerValue'] = i
        state = S.HEADER_VALUE
      case S.HEADER_VALUE:
        if (c == CR) {
          dataCallback('headerValue', true)
          callback('headerEnd')
          state = S.HEADER_VALUE_ALMOST_DONE
        }
        break
      case S.HEADER_VALUE_ALMOST_DONE:
        if (c != LF) {
          return i
        }
        state = S.HEADER_FIELD_START
        break
      case S.HEADERS_ALMOST_DONE:
        if (c != LF) {
          return i
        }
        callback('headersEnd')
        state = S.PART_DATA_START
        break
      case S.PART_DATA_START:
        state = S.PART_DATA
        this.markers['partData'] = i
      case S.PART_DATA:
        prevIndex = index
        if (index == 0) {
          // boyer-moore derrived algorithm to safely skip non-boundary data
          i += boundaryEnd
          while (i < bufferLength && !(buffer[i] in boundaryChars)) {
            i += boundaryLength
          }
          i -= boundaryEnd
          c = buffer[i]
        }
        if (index < boundary.length) {
          if (boundary[index] == c) {
            if (index == 0) {
              dataCallback('partData', true)
            }
            index++
          } else {
            index = 0
          }
        } else if (index == boundary.length) {
          index++
          if (c == CR) {
            // CR = part boundary
            flags |= F.PART_BOUNDARY
          } else if (c == HYPHEN) {
            // HYPHEN = end boundary
            flags |= F.LAST_BOUNDARY
          } else {
            index = 0
          }
        } else if (index - 1 == boundary.length)  {
          if (flags & F.PART_BOUNDARY) {
            index = 0
            if (c == LF) {
              // unset the PART_BOUNDARY flag
              flags &= ~F.PART_BOUNDARY
              callback('partEnd')
              callback('partBegin')
              state = S.HEADER_FIELD_START
              break
            }
          } else if (flags & F.LAST_BOUNDARY) {
            if (c == HYPHEN) {
              callback('partEnd')
              callback('end')
              state = S.END
            } else {
              index = 0
            }
          } else {
            index = 0
          }
        }
        if (index > 0) {
          // when matching a possible boundary, keep a lookbehind reference
          // in case it turns out to be a false lead
          lookbehind[index-1] = c
        } else if (prevIndex > 0) {
          // if our boundary turned out to be rubbish, the captured lookbehind
          // belongs to partData
          callback('partData', lookbehind, 0, prevIndex)
          prevIndex = 0
          this.markers['partData'] = i
          // reconsider the current character even so it interrupted the sequence
          // it could be the beginning of a new sequence
          i--
        }
        break
      case S.END:
        break
      default:
        return i
    }
  }
  
  dataCallback('headerField');
  dataCallback('headerValue');
  dataCallback('partData');
  
  this.state = state
  this.index = index
  this.flags = flags
  
  cb && cb()
}

Multiparser.prototype.end = function () {
  if (this.state != S.END) {
    return new Error('Multiparser.end(): stream ended unexpectedly: ' + this.explain())
  }
}

Multiparser.prototype.explain = function () {
  return 'state = ' + stateToString(this.state)
}

Multiparser.prototype.onPartBegin = function () {
  var self = this
  var part = this.part = new Part()
  part.on('end', function () {
    for (var p in self.activeParts) {
      if (self.activeParts[p] === part) {
        self.activeParts.splice(p, 1)
        break;
      }
    }
    if (self.ended && !self.endEmitted) {
      self.onEnd()
    }
  })
  this.activeParts.push(part)
}

Multiparser.prototype.onHeaderField = function (b, start, end) {
  this.headerField += b.toString(this.encoding, start, end)
}

Multiparser.prototype.onHeaderValue = function (b, start, end) {
  this.headerValue += b.toString(this.encoding, start, end)
}

Multiparser.prototype.onHeaderEnd = function () {
  var headerField = this.headerField
  var headerValue = this.headerValue
  var part = this.part
  var m = null
  headerField = headerField.toLowerCase()
  part.headers[headerField] = headerValue
  if (headerField == 'content-disposition') {
    if (m = headerValue.match(/name="([^"]+)"/i)) {
      part.name = m[1]
    }
    m = headerValue.match(/filename="(.*?)"($| )/i)
    if (!m) return
    var filename = m[1].substr(m[1].lastIndexOf('\\') + 1)
    filename = filename.replace(/%22/g, '"')
    part.filename = filename.replace(/&#([\d]{4})/g, function (m, code) {
      return String.fromCharCode(code)
    })
  } else if (headerField == 'content-type') {
    part.mime = headerValue
  } else if (headerField == 'content-transfer-encoding') {
    part.transferEncoding = headerValue
  }
}

Multiparser.prototype.onHeadersEnd = function () {
  var self = this
  var part = this.part
  
  this.onPartData = function (b, start, end, cb) {
    var written = part.write(b.slice(start, end))
    cb(written)
  }
  
  this.onPartEnd = function () {
    part.end()
  }
  
  this.headerField = ''
  this.headerValue = ''
  this.emit('part', part)
}

Multiparser.prototype.onEnd = function () {
  this.ended = true
  if (this.activeParts.length === 0) {
    this.endEmitted = true
    this.emit('end')
  }
}
