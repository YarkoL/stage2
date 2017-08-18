

"use strict";

var WebSocketServer = require('websocket').server;
var http = require('http');

var httpServer = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();  
});

var port = 1984;
var connections = [];
var nextID = Date.now();

httpServer.listen(port, function() {
  console.log((new Date()) + ' HTTP server is listening on port ' + port);
})

// create the server
var wsServer = new WebSocketServer({
  httpServer: httpServer
});

function originIsAllowed(origin) {
  //in production environment, we would check the origin here
  return true;
}

function isUsernameUnique(name) {
  var isUnique = true;
  var i;

  for (i = 0; i < connections.length; i++) {
    if (connections[i].username === name) {
      isUnique = false;
      break;
    }
  }
  return isUnique;
}

function getConnectionForID(id) {
  var connect = null;
  var i;

  for (i = 0; i < connections.length; i++) {
    if (connections[i].clientID === id) {
      connect = connections[i];
      break;
    }
  }

  return connect;
}

function makeUserListMessage() {
  var userListMsg = {
    type: "userlist",
    users: []
  };
  var i;
  // Add the users to the list
  for (i = 0; i < connections.length; i++) {
    userListMsg.users.push(connections[i].username);
  }

  return userListMsg;
}

function sendMessage(connect, msg, log=false) {
  connect.sendUTF(msg);
  var recipientId = msg.id ? msg.id : 'many'; 
  if (log) {
    console.log('Sent type ' + msg.type + ' response to ' + recipientId)
  }
}

function sendUserListToAll() {
  var userListMsg = makeUserListMessage();
  var userListMsgStr = JSON.stringify(userListMsg);
  var i;

  for (i = 0; i < connections.length; i++) {
    sendMessage(connections[i], userListMsgStr,true);
  }
}

//peer-to-peer send for webRTC
function sendToOneUser(target, msgString) {
  var isUnique = true;
  var i;

  for (i = 0; i < connections.length; i++) {
    if (connections[i].username === target) {
      sendMessage(connections[i], msgString ,true);
      break;
    }
  }
}


// WebSocket server
wsServer.on('request', function(request) {
  var connection = request.accept('my-protocol', request.origin);
  console.log((new Date()) + ' Connection accepted, from ' + request.host );
  connections.push(connection);

  // Send the new client its token; it will
  // respond with its login username.

  connection.clientID = nextID;
  nextID++;

  var msg = {
    type: "id",
    id: connection.clientID
  };
  sendMessage(connection,JSON.stringify(msg),true);

  // all messages from users here.
  connection.on('message', function(message) {
    if (message.type === 'utf8') {
     
       console.log("Received: '" + message.utf8Data + "'");

      var sendToClients = true;
      msg = JSON.parse(message.utf8Data);
      var connect = getConnectionForID(msg.id);

      switch(msg.type) {
        case "message":
          msg.name = connect.username;
          if (msg.name) {
            msg.text = msg.text.replace(/(<([^>]+)>)/ig,"");  
          }
          break;
        case "username":
          sendToClients = false;
          if (!isUsernameUnique(msg.name)) {
            var response  = {
              id: msg.id,
              type: "reject"
              //name: msg.name
            };
            sendMessage(connect,JSON.stringify(response),true);
        
            //TODO we just close now, bur could be handled better.
            connect.close();
	    break;
          }
	/*
	  var response  = {
	      id: msg.id,
              type: "accept",
              name: msg.name
          }
          connect.sendUTF(JSON.stringify(response));
          console.log('Sent type ' + response.type + ' response to ' + msg.id);
          */
          connect.username = msg.name;
          sendUserListToAll();
          break;
        }
       if (sendToClients) {
        var msgString = JSON.stringify(msg);
        var i;

        if (msg.target && msg.target !== undefined && msg.target.length !== 0) {
          sendToOneUser(msg.target, msgString);
        } else {
          for (i = 0; i < connections.length; i++) {
            sendMessage(connections[i],msgString,true);
          }
        }
      }
    }
  });

  connection.on('close', function(connection) {
    connections = connections.filter(function(el, idx, ar) {
      return el.connected;
    });
    sendUserListToAll();  // Update the user lists 
      
    // close user connection
    console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
  });
}); 
