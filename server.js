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

const async = require('async')
const request = require('request')
const xml2js = require('xml2js')

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

/**
 * POST /api/characters
 * Adds new character to the database.
 */
 app.post('/api/characters', (req, res, next) => {
  const gender = req.body.gender
  const characterName = req.body.name
  const characterIdLookupUrl = `https://api.eveonline.com/eve/CharacterID.xml.aspx?names=${characterName}`

  const parser = new xml2js.Parser()

  async.waterfall([
    (cb) => {
      request.get(characterIdLookupUrl, (err, request, xml) => {
        if (err) return next(err)
        parser.parseString(xml, (err, parsedXml) => {
          if (err) return next(err)
          try {
            const characterId = parsedXml.eveapi.result[0].rowset[0].row[0].$.characterID

            Character.findOne({ characterId }, (err, character) => {
              if (err) return next(err)

              if(character)
                return res.status(409).send({ message: `${character.name} is already in the database` })

              cb(err, characterId)
            })
          }
          catch(e) {
            return res.status(400).send({ message: 'XML parse error' })
          }
        })
      })
    },
    (characterId) => {
      const characterInfoUrl = `https://api.eveonline.com/eve/CharacterInfo.xml.aspx?characterID=${characterId}`

      request.get({ url: characterInfoUrl }, (err, request, xml) => {
        if (err) return next(err)
        parser.parseString(xml, (err, parsedXml) => {
          if (err) return next(err)
          try {
            const name = parsedXml.eveapi.result[0].characterName[0]
            const race = parsedXml.eveapi.result[0].race[0]
            const bloodline = parsedXml.eveapi.result[0].bloodline[0]

            const character = new Character({
              characterId,
              name,
              race,
              bloodline,
              gender,
              random: [Math.random(), 0]
            })

            character.save((err) => {
              if (err) return next(err)
              res.send({ message: `${characterName} has been added successfully` })
            })
          }
          catch(e) {
            console.log('ffooooo ', e, JSON.stringify(parsedXml, null ,1))
            res.status(404).send({ message: `${characterName} is not a registered citizen of New Eden.` });
          }
        })
      })
    }
    ])
})

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
