'use strict';

const hostname = window.location.hostname;
trace(hostname, 'Hostname');

const localVideo = document.getElementById('localVideo');

const remoteVideo = document.getElementById('remoteVideo');

const hangupButton = document.getElementById('hangupButton');

const nameInput = document.getElementById('nameInput');
const connectionButton = document.getElementById('connectionButton');

const chat = document.getElementById('chat');
const textInput = document.getElementById('textInput');
const userlist = document.getElementById("userlist");

var clientID = 0;
var connection = null;
var WebSocket = WebSocket || MozWebSocket;

var myUsername = null;
var peerUsername = null;    
var peerConnection = null; 

var canAddTrack = false;

var serverData = {sigserverUri:'', turnUri:'', turnUser:'', turnPwd:''};

var sendChannel = null;       
var receiveChannel = null;    

const constraints = {
  audio: false,
  video: true
};

const offerOptions = {
  offerToReceiveVideo: 1
};

var haveInitiatedConnection = false;

hangupButton.disabled = true;
hangupButton.onclick = hangup;
connectionButton.onclick = loadServerData;

function loadServerData() {
  trace('loading server data...');
  var request = new XMLHttpRequest();
  request.open('GET', '../servers.json');
  request.responseType = 'json';
  request.send();
  request.onload = function() {
    var data = request.response;
    serverData.sigserverUri = data['sigserverUri'];
    serverData.turnUri = data['turnUri'];
    serverData.turnUser = data['turnUser'];
    serverData.turnPwd = data['turnPwd'];
    connect();
  };
}

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

  connection = new WebSocket(serverData.sigserverUri, 'my-protocol');
  
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

function handleKey(evt) {
  if (evt.keyCode === 13 || evt.keyCode === 14) {
    if (!textInput.disabled) {
      var txt = textInput.value
      sendChannel.send(txt);
      //trace('sent txt ' + textInput.value, 'handleKey');
      addMessage("Me: " + txt);
      textInput.value = '';
    }   
  }
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
	'urls':'turn:' + serverData.turnUri,
	'username': serverData.turnUser,
	'credential': serverData.turnPwd
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

function createSendChannel() {

  sendChannel = peerConnection.createDataChannel(myUsername);
  sendChannel.onopen = function(event) {
    trace('Opened data channel', 'createSendChannel')
    textInput.disabled = false;
  }
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
  createSendChannel();
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
    trace('created answer, type ' + answer.type, 'handeVideoOfferMsg');
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
    peerConnection.ondatachannel = setupReceiveChannel;
    createSendChannel();
  })
  .catch(onError);  
}

function setupReceiveChannel(event) {
  trace(' setting up ', 'setupReceiveChannel');
  receiveChannel = event.channel;
  receiveChannel.onopen = function () {
    trace(' opened channel', 'setupReceiveChannel');
  }
  receiveChannel.onmessage = function(event) {
    //trace(' received txt message : ' + event.data, 'setupReceiveChannel');
    addMessage("Peer: " + event.data);
  }
}

function handleVideoAnswerMsg(msg) {
  trace('Peer ' + msg.name + ' accepted our call','handleVideoAnswerMsg');
  var desc = new RTCSessionDescription(msg.sdp);
  peerConnection.setRemoteDescription(desc).catch(onError);
  peerConnection.ondatachannel = setupReceiveChannel;
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
  if (sendChannel) {
    sendChannel.close();
    sendChannel = null;
  }
  if (receiveChannel) {
    receiveChannel.close();
    receiveChannel = null;
  }
  peerConnection.close();
  peerConnection = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  hangupButton.disabled = true;
  textInput.disabled = true;
}

//logging 
function trace(txt, info="") {
	console.log(info + " : " + txt);
}
