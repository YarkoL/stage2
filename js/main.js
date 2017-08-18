'use strict';

var hostname = window.location.hostname;
trace(hostname, 'Hostname');

var localVideo = document.getElementById('localVideo');

var remoteVideo = document.getElementById('remoteVideo');

var hangupButton = document.getElementById('hangupButton');

var nameInput = document.getElementById('nameInput');
var connectionButton = document.getElementById('connectionButton');

var chat = document.getElementById('chat');
var textInput = document.getElementById('textInput');
var userlist = document.getElementById("userlist");

var clientID = 0;
var connection = null;
var WebSocket = WebSocket || MozWebSocket;

var myUsername = null;
var peerUsername = null;    
var peerConnection = null; 

var canAddTrack = false;

var constraints = {
  audio: false,
  video: true
};

var offerOptions = {
  offerToReceiveVideo: 1
};

var haveInitiatedConnection = false;

hangupButton.disabled = true;
hangupButton.onclick = hangup;
connectionButton.onclick = connect;

/*connect with sigserver*/

function setUsername() {
  var msg = {
    name: nameInput.value,
    date: Date.now(),
    id: clientID,
    type: "username"
  };
  sendToServer(msg);
  myUsername = msg.name;
}

function connect() { 
  console.log('connect ');
  var serverUrl;
  var scheme = 'ws';

  // If this is an HTTPS connection, we have to use a secure WebSocket
  // connection too, so add another "s" to the scheme.
  if (document.location.protocol === 'https:') {
    scheme += 's';
  }
  serverUrl = scheme + "://" + hostname + ':1984';
  
  connection = new WebSocket(serverUrl, 'my-protocol');
  
  connection.onopen = function(evt) {
    console.log('connection opened');
    connectionButton.disabled = true;
    textInput.disabled = false; 
  };

  connection.onerror = function(evt) {
    console.log('got error : ' + evt.data);
    connectionButton.disabled = false;
    textInput.disabled = false;
  };

  connection.onmessage = function(evt) {  
    var text = "";
    var msg = JSON.parse(evt.data);
    trace('Recieved message, type : ' + msg.type,'connect');
    var time = new Date(msg.date);
    var timeStr = time.toLocaleTimeString();

    switch(msg.type) {
      case "id":
        clientID = msg.id;
        setUsername();
        break;
	/*
      case "accept":
        text = "<b>User " + msg.name + " signed in at " + timeStr +"</b>"; 
        myUsername = msg.name; 
        break;
	*/
      case "message":
        text =  msg.name + " : " + msg.text;
        break;
      case "reject":
        text = "<b> The name you chose is in use.</b>";
        connectionButton.disabled = false;
        textInput.disabled = true;
        myUsername = null;
        break;
      case "userlist":
        handleUserlistMsg(msg);
        break;
      case "video-offer":  
        handleVideoOfferMsg(msg);
        break;  
      case "video-answer":  
        handleVideoAnswerMsg(msg);
        break;
      case "new-ice-candidate": 
        handleNewICECandidateMsg(msg);
        break;
      case "hangup": 
        //TODO handleHangUpMsg(msg);
        break;
      default:
        trace(msg.type,'UNKNOWN MESSAGE');
      if (text.length) {
        addMessage(text);
      }
    }
  };
}

function addMessage(txt) {
  chat.innerHTML += txt + '<br>';
}

/*Peer connection*/

function invite(evt) {
  
  if (!peerConnection) {
    var clickedUsername = evt.target.textContent;

    if (clickedUsername === myUsername) {
      alert("Pick some other user than yourself to chat with, OK? :)");
      return;
    }
    peerUsername = clickedUsername;
    trace('clicked ' + peerUsername, 'invite');
    
    createPeerConnection();
    getVideo();
    haveInitiatedConnection = true;
  } else {
    alert("You have already an open connection");
  }
}

function getVideo() {
  trace('Attempting to get media', 'getVideo');
	navigator.mediaDevices.getUserMedia(constraints)
	.then(function(stream) {
      trace('Adding local stream.','getVideo');
      localVideo.srcObject = stream;
      if (canAddTrack) {
        trace('Adding tracks to peer connection', 'getVideo');
        stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
      } else {
        trace('Adding stream to peer connection', 'getVideo');
        peerConnection.addStream(stream);
      }
  })
	.catch(onError);
}

function createPeerConnection(stream) {
  var servers =  {'iceServers':[{
	'urls':'turn:',
	'username':'',
	'credential':''
	}]};

  peerConnection = new RTCPeerConnection(servers);

  canAddTrack = (peerConnection.addTrack !== undefined);
  
  //got ICE cand. to be transmitted to a peer
  peerConnection.onicecandidate = handleICECandidateEvent;
  //remote track event
  peerConnection.ontrack = handleTrackEvent; 
  //remote stream has been added to your connection (Deprecated)
  peerConnection.onaddstream = handleAddStreamEvent; 
  //remote stream has been removed from your connection
  peerConnection.onremovestream = handleRemoveStreamEvent;
  //you need to create & send offer
  peerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
}

/*Event handlers*/

function handleTrackEvent(event) {
  trace('Track event');
  remoteVideo.srcObject = event.streams[0];
  hangupButton.disabled = false;
}

function handleAddStreamEvent(event) {
  trace('Added stream');
  remoteVideo.srcObject = event.stream;
  hangupButton.disabled = false;
}

function handleRemoveStreamEvent(event) {
  trace('Stream removed');
  //TODO closeVideoCall();
}

function handleNegotiationNeededEvent() {
  if (!haveInitiatedConnection) {
     return;
  }
  peerConnection.createOffer(offerOptions).then(function(offer) {
    // https://tools.ietf.org/html/rfc3264
    trace('created offer, type ' + offer.type, 'handleNegotiationNeededEvent');
    return peerConnection.setLocalDescription(offer);
  })
  .then(function() {
    sendToServer({
      name: myUsername,
      target: peerUsername,
      type: "video-offer",
      sdp: peerConnection.localDescription
    });
  })
  .catch(onError);
}

function handleICECandidateEvent(event) {
  if (event.candidate) {
    trace("Outgoing ICE candidate: " + event.candidate.candidate);

    sendToServer({
      type: "new-ice-candidate",
      target: peerUsername,
      candidate: event.candidate
    });
  }
}

/*Message handlers*/

function handleUserlistMsg(msg) {
  var i;
  //clear list
  while (userlist.firstChild) {
    userlist.removeChild(userlist.firstChild);
  }
  //repopulate UI
  for (i = 0; i < msg.users.length; i++) {
    var item = document.createElement('span');
    item.classList.add('useritem');
    item.appendChild(document.createTextNode(msg.users[i]));
    item.addEventListener("click", invite, false);
    //put into list
    userlist.appendChild(item);
  }
}

function handleNewICECandidateMsg(msg) {
  var candidate = new RTCIceCandidate(msg.candidate);

  trace("Adding received ICE candidate: " + JSON.stringify(candidate));
  peerConnection.addIceCandidate(candidate).catch(onError);
}

function handleVideoOfferMsg(msg) {
  var stream = null;
  peerUsername = msg.name;

  createPeerConnection();

  var desc = new RTCSessionDescription(msg.sdp);

  peerConnection.setRemoteDescription(desc).then(function() {
    //same as getVideo() 
    trace('Attempting to get media', 'handleVideoOfferMsg');
    return navigator.mediaDevices.getUserMedia(constraints);
    })
      .then(function(stream) {
         trace('Adding local stream.','handleVideoOfferMsg');
         localVideo.srcObject = stream;

         if (canAddTrack) {
           trace('Adding tracks to peer connection', 'handleVideoOfferMsg');
           stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
         } else {
          trace('Adding stream to peer connection', 'handleVideoOfferMsg');
          peerConnection.addStream(stream);
        }
  }).then(function() {
    return peerConnection.createAnswer();
  })
  .then(function(answer) {
    trace('created answer, type ' + answer.type, 'handleVideoOfferMsg');
    return peerConnection.setLocalDescription(answer);
  })
  .then(function() {
    var msg = {
      name: myUsername,
      target: peerUsername,
      type: "video-answer",
      sdp: peerConnection.localDescription
    };
    sendToServer(msg);
  })
  .catch(onError);  
}

function handleVideoAnswerMsg(msg) {
  trace('Peer ' + msg.name + ' accepted our call','handleVideoAnswerMsg');
  var desc = new RTCSessionDescription(msg.sdp);
  peerConnection.setRemoteDescription(desc).catch(onError);
}

function sendToServer(msg) {
  var msgJSON = JSON.stringify(msg);
  trace('Attempting to send ' + msg.type + ' type message: ' + msgJSON, 'sendtoServer');
  connection.send(msgJSON);
}

function onError(err) {
	trace(err.toString(), 'Error');
}

function hangup() {
  trace('Ending call','Hangup');
  peerConnection.close();
  peerConnection = null;
  localVideo.srcObject = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
}

//logging 
function trace(txt, info="") {
	console.log(info + " : " + txt);
}
