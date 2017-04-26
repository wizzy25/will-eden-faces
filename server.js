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
const _ = require('underscore')

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
            res.status(404).send({ message: `${characterName} is not a registered citizen of New Eden.` });
          }
        })
      })
    }
    ])
})

/**
 * PUT /api/characters
 * Update winning and losing count for both characters.
 */
app.put('/api/characters', (req, res, next) => {
  const winner = req.body.winner
  const loser = req.body.loser

  if (!winner || !loser)
    return res.status(400).send({ message: 'Voting requires two characters, but you know this already' })
  if (winner === loser)
    return res.status(400).send({ message: 'Cannot vote for and against the same person you dimwit' })

  async.parallel([
    (cb) => {
      Character.findOne({ characterId: 'winner' }, (err, winner) => {
        cb(err, winner)
      })
    },
    (cb) => {
      Character.findOne({ characterId: 'loser' }, (err, loser) => {
        cb(err, loser)
      })
    }
  ], (err, results) => {
    if (err)
      return next(err)

    const [winner, loser] = results

    if (!winner || !loser)
      return res.status(404).send({ message: 'One of the characters is now extinct' })
    if (winner.voted || loser.voted)
      return res.status(200).end()

    async.parallel([
      (cb) => {
        winner.wins++
        winner.voted = true
        winner.random = [Math.random(), 0]
        winner.save((err) => cb(err))
      },
      (cb) => {
        loser.losses++
        loser.voted = true
        loser.random = [Math.random(), 0]
        loser.save((err) => cb(err))
      }
    ], (err) => {
      if (err)
        return next(err)
      res.status(200).end()
    })
  })
})

/**
 * GET /api/characters
 * Returns 2 random characters of the same gender that have not been voted yet.
 */
app.get('/api/characters', (req, res, next) => {
  const choices = ['Female', 'Male']
  const randomGender = _.sample(choices)

  Character.find({ random: { $near: [Math.random(), 0] } })
    .where('voted', false)
    .where('gender', randomGender)
    .limit(2)
    .exec((err, characters) => {
      if (err)
        return next(err)
      if (characters.length === 2)
        return res.send(characters)

      const oppositeGender = _.first(_.without(choices, randomGender))

      Character.find({ random: { $near: [Math.random(), 0] } })
        .where('voted', false)
        .where('gender', oppositeGender)
        .limit(2)
        .exec((err, characters) => {
          if (err)
            return next(err)
          if (characters.length === 2)
            return res.send(characters)

          Character.update({}, { $set: { voted: false } }, { multi: true }, (err) => {
            if (err)
              return next(err)
            res.send([])
          })
        })
    })
})

/**
 * GET /api/characters/search
 * Looks up a character by name. (case-insensitive)
 */
app.get('/api/characters/search', (req, res, next) => {
  const characterName = new RegExp(req.query.name, 'i')

  Character.findOne({ name: 'characterName' }, (err, character) => {
    if (err)
      return next(err)
    if (!character)
      return res.status(404).send({ message: 'Character is lost and cannot be found' })

    res.send(character)
  })
})

/**
 * GET /api/characters/top
 * Return 100 highest ranked characters. Filter by gender, race and bloodline.
 */
app.get('/api/characters/top', (req, res, next) => {
  const params = req.query
  const conditions = {}

  _.each(params, (value, key) => {
    conditions[key] = new RegExp(`^${value}$`, 'i')
  })

  Character
    .find(conditions)
    .sort('-wins') // Sort so that wins always stay top
    .exec((err, characters) => {
      if (err)
        return next(err)

      // sort by winning percentage
      characters.sort((a, b) => {
        if (a.wins / (a.wins + a.losses) < b.wins / (b.wins + b.losses))
          return 1
        if (a.wins / (a.wins + a.losses) > b.wins / (b.wins + b.losses))
          return -1
        return 0
      })

      res.send(characters)
    })
})

/**
 * GET /api/characters/shame
 * Returns 100 lowest ranked characters.
 */
app.get('/api/characters/shame', (req, res, next) => {
  Character
    .find()
    .sort('-losses')
    .limit(100)
    .exec((err, characters) => {
      if (err)
        return next(err)
      res.send(characters)
    })
})

/**
 * GET /api/characters/count
 * Returns the total number of characters.
 */
app.get('/api/characters/count', (req, res, next) => {
  Character.count({}, (err, count) => {
    if (err)
      return next(err)
    res.send({ count })
  })
})

/**
 * GET /api/characters/:id
 * Returns detailed character information.
 */
app.get('/api/characters/:id', (req, res, next) => {
  const id = req.params.id

  Character.findOne({ characterId: id }, (err, character) =>{
    if (err)
      return next(err)
    if (!character)
      return res.status(404).send({ message: 'Character is lost and cannot be found' })

    res.send(character)
  })
})

/**
 * POST /api/report
 * Reports a character. Character is removed after 4 reports.
 */
app.post('/api/report', (req, res, next) => {
  const characterId = req.body.characterId

  Character.findOne({ characterId }, (err, character) => {
    if (err)
      return next(err)
    if (!character)
      return res.status(404).send({ message: "Character can never be found" })

    character.reports++

    if (character.reports > 4) {
      character.remove()
      return res.send({ message: `${character.name} has been annihilated!!!` })
    }

    character.save((err) => {
      if (err)
        return next(err)
      res.send({ message: `${character.name} has been reported; now pending annihilation.` })
    })
  })
})

/**
 * GET /api/stats
 * Returns characters statistics.
 */
app.get('/api/stats', (req, res, next) => {
  async.parallel([
    (cb) => {
      Character.count({}, (err, count) => {
        cb(err, count)
      })
    },
    (cb) => {
      Character.count({ race: 'Amarr' }, (err, amarrCount) => {
        cb(err, amarrCount)
      })
    },
    (cb) => {
      Character.count({ race: 'Caldari' }, (err, caldariCount) => {
        cb(err, caldariCount)
      })
    },
    (cb) => {
      Character.count({ race: 'Gallente' }, (err, gallenteCount) => {
        cb(err, gallenteCount)
      })
    },
    (cb) => {
      Character.count({ race: 'Minmatar' }, (err, minmatarCount) => {
        cb(err, minmatarCount)
      })
    },
    (cb) => {
      Character.count({ gender: 'Male' }, (err, maleCount) => {
        cb(err, maleCount)
      })
    },
    (cb) => {
      Character.count({ gender: 'Female' }, (err, femaleCount) => {
        cb(err, femaleCount)
      })
    },
    (cb) => {
      Character.aggregate({
        $group: {
          _id: null,
          total: {
            $sum: '$wins'
          }
        }
      }, (err, totalVotes) => {
        const total = totalVotes.length ? totalVotes[0].total : 0
        cb(err, total)
      })
    },
    (cb) => {
      Character
        .find()
        .sort('-wins')
        .limit(100)
        .select('race')
        .exec((err, characters) => {
          if (err)
            return next(err)

          const raceCount = _.countBy(characters, (char) => char.race)
          const max = _.max(raceCount, (race) => race)
          const inverted = _.invert(raceCount)
          const topRace = _.inverted(max)
          const topCount = raceCount.topRace

          cb(err, { race: topRace, count: topCount })
        })
    },
    (cb) => {
      Character
        .find()
        .sort('-wins')
        .limit(100)
        .select('bloodline')
        .exec((err, characters) => {
          if (err)
            return next(err)

          const bloodlineCount = _.countBy(characters, (char) => char.bloodline)
          const max = _.max(bloodlineCount, (bloodline) => bloodline)
          const inverted = _.invert(bloodlineCount)
          const topBloodline = _.inverted(max)
          const topCount = bloodlineCount.topBloodline

          cb(err, { bloodline: topBloodline, count: topCount })
        })
    }
  ], (err, results) => {
    if (err)
      return next(err)

    res.send({
      totalCount: results[0],
      amarrCount: results[1],
      caldariCount: results[2],
      gallenteCount: results[3],
      minmatarCount: results[4],
      maleCount: results[5],
      femaleCount: results[6],
      totalVotes: results[7],
      leadingRace: results[8],
      leadingBloodline: results[9]
    })
  })
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
