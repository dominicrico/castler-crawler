const request = require('request')
const cheerio = require('cheerio')
const async = require('async')
const mongoose = require('mongoose')
const ora = require('ora')
const gridfs = require('gridfs-stream')
const chalk = require('chalk')
const path = require('path')

const Castle = require('./models/castle')

const BASE_URL = 'https://alleburgen.de/'
const CASTLE_URL = `${BASE_URL}bd.php?id=`

const crawlStart = new Date().getTime()

const spinner = ora({
  text: `${chalk.bold.green('Preparing 🏰 crawler...')}`,
  color: 'magenta',
  hideCursor: true
}).start()

const castles = []
const emptyCastles = []
const missingImages = []

let currentCastle
let storedCastles = 0
let maxCastlesCount = 35653

gridfs.mongo = mongoose.mongo;

mongoose.connection.once('open', () => {
  spinner.text = `${chalk.bold.green('🏰 DB connection estblished! 🏰')}`
  const gfs = gridfs(mongoose.connection.db)

  async.timesLimit(maxCastlesCount, 10, function(n, done) {
    spinner.text = `${chalk.bold.green('🏰 Let\'s go! 🏰')}`
    let getCastle = async.retryable({times: 5, interval: 2000}, function(){
      spinner.text = chalk.bold.green(`🏰 ${CASTLE_URL}${n} 🏰`)
      request({
        uri: `${CASTLE_URL}${n}`,
      }, function(err, response, body) {
        if (err) {
          console.log(err)
          return done(err)
        }

        const $ = cheerio.load(body)

        if ($('h1').text() === '') {
          emptyCastles.push(n)
          return done(null)
        }

        currentCastle = {
          name: $('h1').text(),
          alternate_names: $('h1').next().text().split(', '),
          type:  $('h1').next().next().text(),
          dimensions: [],
          location: {},
          description: '',
          preserved: '',
          owners: [],
          history: [],
          litrature: [],
          utilization: [],
          images: [],
          links: [],
          abId: n
        }

        $('.panel, .table-responsive').each((i, el) => {
          let label
          if ($(el).prev().is('h4')) {
            label = $(el).prev().text()
          } else if ($(el).prev().prev().is('h4')) {
            label = $(el).prev().prev().text()
          }

          if (label === 'Lage') {
            $(el).find('tr').each((i, el) => {
              const $tr = $(el)
              const trLabel = $(el).find('td').first()
              if (trLabel.text().indexOf('Land') !== -1) currentCastle.location.country = trLabel.next().text().trim()
              if (trLabel.text().indexOf('Bundesland') !== -1 || trLabel.text().indexOf('Canton') !== -1 || trLabel.text().indexOf('Provinz') !== -1 ) currentCastle.location.state = trLabel.next().text().trim()
              if (trLabel.text().indexOf('Bezirk') !== -1 || trLabel.text().indexOf('Arrondissement') !== -1 || trLabel.text().indexOf('Bezirksgemeinschaft') !== -1) {
                currentCastle.location.region = trLabel.next().text().trim()
                if (trLabel.text().indexOf('Bezirk') !== -1) currentCastle.location.department = $tr.next().find('td').first().next().text().trim()
              }
              if (trLabel.text().indexOf('Départment') !== -1) currentCastle.location.department = trLabel.next().text().trim()
              if (trLabel.text().indexOf('Ort') !== -1) currentCastle.location.city = trLabel.next().text().trim()
              if (trLabel.text().indexOf('Adresse') !== -1) currentCastle.location.street = trLabel.next().text().trim()
              if (trLabel.text().indexOf('Koordinaten') !== -1) currentCastle.location.coordinates = trLabel.next().text().replace(/°/gmi, '').split(', ')
            })
          }

          if (label === 'Besitzer') {
            $(el).find('tr').each((i, el) => {
              const $tr = $(el)
              currentCastle.owners.push({name: $tr.find('th').text().trim(), date: $tr.find('td').text().trim()})
            })
          }

          if (label === 'Historie') {
            $(el).find('tr').each((i, el) => {
              const $tr = $(el)
              currentCastle.history.push({date: $tr.find('th').text().trim(), description: $tr.find('td').text().trim()})
            })
          }

          if (label === 'Maße') {
            $(el).find('tr').each((i, el) => {
              const $tr = $(el)
              currentCastle.dimensions.push($tr.find('td').text().trim())
            })
          }

          if (label === 'Beschreibung') {
            const desc = $(el).find('.dropcap').parent().text().split('Erhalten: ')

            if (desc.length > 1) {
              currentCastle.description = desc[0].trim()
              currentCastle.preserved = desc[1].trim()
            } else if (desc.length === 1 && desc[0].indexOf('Erhalten:') !== -1) {
              currentCastle.preserved = desc[0].replace('Erhalten: ', '').trim()
            } else {
              currentCastle.description = desc[0].trim()
            }
          }
        })

        $('.sidebar div').each((i, el) => {
          let label
          if ($(el).prev().is('h4')) {
            label = $(el).prev().text()
          }

          if (label ===  'Nutzung') {
            $(el).find('li').each((i, el) => {
              currentCastle.utilization.push($(el).text())
            })
          }

          if (label === 'Externe Links') {
            $(el).find('li').each((i, el) => {
              $a = $(el).find('a')
              currentCastle.links.push({text: $a.text(), url: $a.attr('href')})
            })
          }
        })

        $('.icon-book').each((i, el) => {
          currentCastle.litrature.push($(el).parent().text().trim())
        })

        $('.masonry-thumbs img').each((i, el) => {
          let imageURL = $(el).attr('src').substr(2, $(el).attr('src').length)
          currentCastle.images.push({url: `${BASE_URL}${imageURL}`})
        })

        $('.masonry-thumbs').parent().next().find('ul li').each((i, el) => {
          $(el).html().split('<br>').forEach((copyright) => {
            if (copyright.match(/Bild \d+:/g) && copyright.match(/Bild \d+:/g).length) {
              let imageIndex = parseInt(copyright.match(/Bild \d+:/g)[0].replace(/Bild|:/g, '')) - 1;
              currentCastle.images[imageIndex].copyright = copyright.replace(copyright.match(/Bild \d+:/g)[0], '').trim()
            }
          })
        })

        if (currentCastle.name && currentCastle.name.length > 0) {
          castles.push(currentCastle)
        } else {
          emptyCastles.push(n)
        }

        spinner.text = `${chalk.bold.blue('Crawling 🏰...')} ${chalk.green('Found:')} ${chalk.green.bold(castles.length)}, ${chalk.red('Skipped:')} ${chalk.red.bold(emptyCastles.length)}`

        return done(err)
      })
    })

    return getCastle(n, done)
  },
  function (err, n) {
    console.log(err)
    if (err) spinner.fail(err.message)

    spinner.text = `${chalk.bold.blue('Storing 🏰 images into database...')}`

    async.eachSeries(castles, (castle, done) => {
      if (!castle.images || castle.images.length < 1) return done(null);

      async.eachOfSeries(castle.images, (image, idx, next) => {
        let getImage = async.retryable({times: 5, interval: 2000}, function(){
          let contentType;
          let writeStream = gfs.createWriteStream({
            content_type: contentType || 'image/jpeg',
            filename: image.url.split('/')[image.url.split('/').length - 1]
          })

          writeStream.on('close', (file) => {
            castle.images[idx]['_id'] = file._id;
            return next(null);
          }).on('error', (err) => {
            console.log(err)
            missingImages.push(image)
            return next(err)
          })

          spinner.text = chalk.bold.blue(`Storing ${image.url}...`)

          request.head(`${image.url}`, (err, res, body) => {
            if (res.statusCode >= 400) return next(null)
            if (err) return next(err)
            if (!err && res.headers && res.headers['content-type']) contentType = res.headers['content-type']
            if (!err && res.headers && res.headers['content-length']) request(`${image.url}`).on('error', (err) => {
              if (err) console.log(err)
              missingImages.push(image)

            }).pipe(writeStream)
          })
        })

        getImage(next)
      }, (err) => {
        if (err) console.log(err)
        return done(err)
      })
    }, (err) => {
      spinner.text = chalk.bold.blue(`Storing 🏰 to database...`)
      Castle.insertMany(castles, (err) => {
        const crawlEnd = new Date().getTime()
        const timeDiff = crawlEnd - crawlStart

        if (err) console.log(err)
        if (!err) spinner.succeed(`🏰 Done in ${convertMs(timeDiff)} min.`)
        else spinner.fail(err.message)

        console.log(missingImages)

        process.exit(1)
      })
    })
  })
})

mongoose.connect('mongodb://localhost:27017/Castler', { useNewUrlParser: true })

function convertMs(ms) {
  const s= ms/ 1000
  const min = Math.floor(s/60)
  const sec = Math.round(s - (min * 60))


  return `${min}:${sec}`
}
