'use strict'

require('babel-register')

const http = require('http')
const path = require('path')
const logger = require('morgan')
const express = require('express')
const bodyParser = require('body-parser')
const mongoose = require('mongoose')
const swig = require('swig')
const React = require('react')
const ReactDOM = require('react-dom/server')
const Router = require('react-router')
const routes = require('./app/routes')
const Character = require('./models/Character')
const config = require('./config')

const app = express()
const server = http.createServer(app)
const io = require('socket.io')(server)
let onlineUsers = 0

mongoose.connect(config.database)
mongoose.connection.on('error', () => {
  console.info('Error: Could not connect to MongoDB. Did you forget to run `mongod`?')
})

app.set('port', process.env.PORT || 3000)
app.use(logger('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.static(path.join(__dirname, 'public')))

app.use((req, res) =>
  Router.match({ routes: routes.default, location: req.url }, (err, redirLocation, renderProps) => {
    if (err)
      res.status(500).send(err.message)
    else if (redirLocation)
      res.status(302).redirect(redirLocation.pathName + redirLocation.search)
    else if (renderProps) {
      const html = ReactDOM.renderToString(React.createElement(Router.RoutingContext, renderProps))
      const page = swig.renderFile('views/index.html', { html: html })
      res.status(200).send(page)
    }
    else
      res.status(404).send('Page not found')
  })
)

io.sockets.on('connection', () => {
  onlineUsers++
  io.sockets.emit('onlineUsers', { onlineUsers })

  io.sockets.on('disconnect', () => {
    onlineUsers--
    io.sockets.emit('onlineUsers', { onlineUsers })
  })
})


server.listen(app.get('port'), () =>
  console.log('Express server listening on port ' + app.get('port'))
)
