//Setup web server and socket
var twitter = require('twitter'),
    express = require('express'),
    app = express(),
    http = require('http'),
    server = http.createServer(app),
    io = require('socket.io').listen(server)
  , elasticsearch = require('elasticsearch')
  , global_socket, global_stream, client
  , path = require('path')
  , moment = require('moment');

//Setup twitter stream api
var twit = new twitter({
  consumer_key: 'bPRnzhcLJxr1gSgcpDWXeXSm3',
  consumer_secret: 'gz4WCIGj7lGVKbdA8imqTwntXO86yuhGks75m0NLO5kRDlplcD',
  access_token_key: '1068719712-GblrfVA2vneQH6gKvcMiw99ha9bTmfTpfCkBjEQ',
  access_token_secret: 'bpGM0csnYnXwNTdZHww3wVgffNO5Omz6V0P8o5pAXW7KU'
}),
stream = null;

var client = new elasticsearch.Client({
  host: 'localhost:9200'
});

//Use the default port (for beanstalk) or default to 8081 locally
server.listen(process.env.PORT || 8081);

//Setup rotuing for app
app.use(express.static(__dirname + '/public'));

// function emitTweet(data){
//   global_socket.emit('tweet', data);
// }

//Save each tweet in callback into elasticsearch 
function saveIntoElasticSearch(aTweet){
  var myKey = aTweet.id_str;
  var myDate = moment(aTweet.created_at);
  aTweet.created_at = myDate;
  
  client.index({
    index: 'tweets',
    type: 'tweet',
    id: myKey,
    body: aTweet
  }, function (err, resp) {
    console.info(err);
    console.info(resp);
  });
}

// function searchInElasticSearch(keyword) {
//   var hits;
//   client.search({
//     index: 'tweets',
//     type: 'tweet',
//     body: {"query":{"bool":{"must":[{"term":{"text":keyword.trim()}}],"must_not":[],"should":[]}},"from":0,"size":10,"sort":[],"aggs":{}}
//   }).then(function (resp) {
//       hits = resp.hits.hits;
//       console.info(hits);
//   }, function (err) {
//       console.trace(err.message);
//   });
//   return hits;
// }

//Create web sockets connection.
io.sockets.on('connection', function (socket) {
  global_socket = socket;
  socket.on("start tweets", function() {
    if(stream === null) {
      //Connect to twitter stream passing in filter for entire world.
      twit.stream('statuses/filter', {'locations':'-180,-90,180,90'}, function(stream) {
          global_stream = stream;
          stream.on('error', function(a,b){
            console.error(a);
            console.error(b);
          });
          stream.on('data', function(data) {
              // Does the JSON result have coordinates
              saveIntoElasticSearch(data);
              if (data.coordinates){
                if (data.coordinates !== null){
                  //If so then build up some nice json and send out to web sockets
                  var outputPoint = {"lat": data.coordinates.coordinates[0],"lng": data.coordinates.coordinates[1]};

                  socket.broadcast.emit("twitter-stream", outputPoint);

                  //Send out to web sockets channel.
                  socket.emit('twitter-stream', outputPoint);
                }
                else if(data.place){
                  if(data.place.bounding_box.type === 'Polygon'){
                    // Calculate the center of the bounding box for the tweet
                    var coord, _i, _len;
                    var centerLat = 0;
                    var centerLng = 0;
                    var coords = data.place.bounding_box.coordinates;
                    for (_i = 0, _len = coords.length; _i < _len; _i++) {
                      coord = coords[_i];
                      centerLat += coord[0];
                      centerLng += coord[1];
                    }
                    centerLat = centerLat / coords.length;
                    centerLng = centerLng / coords.length;

                    // Build json object and broadcast it
                    var outputPoint = {"lat": centerLat,"lng": centerLng};
                    socket.broadcast.emit("twitter-stream", outputPoint);

                  }
                }
              }
              stream.on('limit', function(limitMessage) {
                return console.log(limitMessage);
              });

              stream.on('warning', function(warning) {
                return console.log(warning);
              });

              stream.on('disconnect', function(disconnectMessage) {
                return console.log(disconnectMessage);
              });
          });
      });
    }
  });

  global_socket.on('start search', function(data) {
    console.info("searching");
    // socket.emit("searching", searchInElasticSearch(data));
    // var result = searchInElasticSearch(data);
    // console.info("test");
    // console.info(result);
    // if(typeof result != "undefined" && result !== null) {
    //   socket.emit("searching", result);
    // }
    client.search({
    index: 'tweets',
    type: 'tweet',
    body: {"query":{"bool":{"must":[{"term":{"text":data.trim()}}],"must_not":[],"should":[]}},"from":0,"size":10,"sort":[],"aggs":{}}
    }).then(function (resp) {
        var hits = resp.hits.hits;
        socket.emit("searching", hits);
    }, function (err) {
        console.trace(err.message);
    });
  });

  // Stop
  global_socket.on('stop tweets', function(socket) {
    global_stream.destroy();
  });

    // // Emits signal to the client telling them that the
    // // they are connected and can start receiving Tweets
    // socket.emit("connected");
});

