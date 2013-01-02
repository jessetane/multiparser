#!/usr/bin/env node

/*
 *  http.js
 *
 */


var fs = require('fs')
var Multiparser = require('../')
var http = require("http")
var updir = '/tmp/'

http.createServer(function (req, res) {
  if (req.url === "/upload" && req.method === "POST") {
    
    var error = null
    var progress = 0
    var parser = new Multiparser(req)
    
    parser.on('error', function (err) {
      error = err
    })
    
    parser.on('progress', function (parsed, total) {
      var currentProgress = ~~(parsed / total * 100)
      if (currentProgress != progress) {
        console.log('uploading...', currentProgress, req._readableState.length)
        progress = currentProgress
      }
    })
    
    parser.on('part', function (part) {
     part.on('end', function () {
       if (part.filename) {
         console.log('uploaded file "' + part.name + '" to ' + updir + part.filename)
       } else if (part.value) {
         console.log('parsed field "' + part.name + '" as "' + part.value + '"')
       }
     })
     if (part.filename) {
        var file = fs.createWriteStream(updir + part.filename)
        part.destination = file
        part.pipe(file)
     } else {
       part.value = ''
       part.on('readable', function () {
         part.value += part.read()
       })
       part.read(0)
     }
    })
    
    parser.on('end', function () {
      if (error) {
        res.writeHeaders(500)
        return res.end(err.message)
      } else {
        res.end('all parsed!')
      }
    })
    
  } else {
    
    res.end('<html>\
      <form enctype="multipart/form-data" method="POST" action="/upload">\
      <input name="fieldup" type="text" /><br>\
      <input name="fileup" type="file" multiple="true" /><br>\
      <input type="submit" value="upload" />\
      </form>\
      </html>')
      
  }
}).listen(8080)
