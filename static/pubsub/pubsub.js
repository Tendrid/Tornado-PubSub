/***
 * pubsub.js
 */
// show debug info in console
var isDebug = false;
dojo.require("dojox.encoding.digests.MD5");
dojo.require("dojo.io.script");
dojo.require("dojo.store.Memory");

function getCookie(name) {var r = document.cookie.match("\\b" + name + "=([^;]*)\\b"); return r ? r[1] : undefined;}
Object.size = function(obj) { var size = 0, key; for (key in obj) { if (obj.hasOwnProperty(key)) size++; } return size; }


/** Constants
 *		events:		 used for ui hooks
 *		state:		 used for ui hooks
 *		err_message: used for pipe and apps on error messages
 *		sys_message: used for pipe and apps messages.
 *					 all messages counter err_message so a simple bitwise compare can determine if error is fixed
 *						ie: if(err_msg ^ sys_msg){ error persists }else{ error fixed }
 *					 messages can also be combined to determin total state of app
 *						ie: (PUBSUB.ERR_MESSAGE.CONNECTION_FAILED|PUBSUB.ERR_MESSAGE.MISC_ERROR|PUBSUB.ERR_MESSAGE.REDPILL) ^ (PUBSUB.SYS_MESSAGE.MISC_ERROR_RECOVER|PUBSUB.SYS_MESSAGE.CONNECTION_RESTORED)
 *						above we submit that we have a misc error combined with a failed connection, and oh no! someone took the redpill.
 *						but then, we show that the misc error recovered, and the connection was restore, our remainder is 4 (which is equal to PUBSUB.ERR_MESSAGE.REDPILL)
 */

var PUBSUB = {
		EVENTS:{'SUBSCRIBE':0,'UNSUBSCRIBE':1,'PUBLISH':2,'UNPUBLISH':4,'META_UPDATE':8},
		CALLBACKS:{'ANY':63,'META':1,'CHANNEL':2,'CHANNEL_ITEM':4,'USER':8,'SUBSCRIBE':16,'UNSUBSCRIBE':32},
		STATE:{'PRE':0,'POST':1},
		ERR_MESSAGE:{'CLEAR':0,'MISC_ERROR':1,'CONNECTION_FAILED':2,'INVALID_META':4},
		SYS_MESSAGE:{'CLEAR':0,'MISC_ERROR_RECOVER':1,'CONNECTION_RESTORED':2,'INVALID_META_CLEARED':4}
	}

/***
 * 	mixed: param channels
 * 	function: callback
 * 	array: retVal array to append subscriptions
 * 
 * 	CURRENT LIMITATIONS
 *	channels can have wildcard, but the wildcard is currently limited to the following:
 *	#1 root/* will subscribe to root/news, root/news/special, etc
 *	#2 root/* /special will NOT match only root/news/special.  It will match the same as #1
 */

var apps = {
	ready:{},
	files:{},
	/**
	 * Fired under the scope of the created app
	 */
	_mixin_sub:function(callback, channels){
		var me = this;
		_cb = function(m){
			me[callback](m);
			// TODO: instead of adding raw data to the library, have callback create dijit or default dijit
			me.library.put(m,{'id':m.id});
		}
		var chan = apps._match(channels);
		for(var ind in chan){
			this._subs.push(dojo.subscribe('pubsub/'+chan[ind].path, _cb));
			this.channels[chan[ind].path] = chan[ind];
		}
	},
	_mixin_activate:function(){
		if(this.onLoad){
			this.onLoad();
		}
		if(this.subscribe){
			for(var i in this.subscribe){
				this.sub(i, this.subscribe[i]);
			}
		}
		if(this.onReady){
			this.onReady();
		}
		this._active = true;
	},
	_mixin_sort:function(key, descending, callback){
		// descending
		// false == 1-100
		// true  == 100-1
		var _s = this.library.query({}, {sort: [{attribute: key,descending: descending}]}).forEach(function(item){
			callback(item);
		});
	},
	activate:function(){
		for(var app in this.ready){
			if(this.ready[app].activate && !this.ready[app]._active){
				this.ready[app].activate();
			}
		}
	},
	_match:function(channels){
		var _out = [];
		if((typeof channels) == 'string'){ channels = [channels]; }
		for(channel in channels){
			// match if not '*'
			if(channels[channel].indexOf('*') > 0){
				for(_ch in pipe.channels){
					if(_ch.match(channels[channel]) != null){
						_out.push(pipe.channels[_ch]);
					}
				}
			}else{
				_out.push(pipe.channels[channels[channel]]);
			}
		}
		return _out;
	},
	onError:function(err){
		for(var i in apps.ready){
			apps.ready[i].err |=err;
			if(apps.ready[i].onError){
				apps.ready[i].onError(err);
			}
		}
	},
	onErrorClear:function(msg){
		for(var i in apps.ready){
			apps.ready[i].err |=msg;
			if(apps.ready[i].onErrorClear){
				apps.ready[i].onErrorClear(msg);
			}
		}		
	},
	hook:function(args){
		//TODO: use dojo.connect / dojo.hitch
		var required = {'channels'	: 'object',
						'event'		: 'number',
						'state'		: 'number',
						'obj'		: 'string',
						'func'		: 'string'};
		if(typeof args['channels'] == 'string'){ args['channels'] = [args['channels']]}		
		for (arg in required){
			if(typeof args[arg] != required[arg]){
				// TODO: take this out of console.error
				console.error(arg+' must be a '+required[arg]);
			}
		}
		channels = apps._match(args['channels']);
		for (k in channels){
			//channels[k]._hooks[args['event']][args['state']][args['obj']] = args['func'];
			args.ready = true;
			//channels[k]._hooks[args['event']][args['state']][args['obj']+args['func']] = {'obj':args['obj'],'func':args['func'],'ready':true};
			channels[k]._hooks[args['event']][args['state']][args['obj']+'|'+args['func']] = args;
		}
		//this._callbacks[hook] = callback;
	},
	register:function(apps){
		for(var app in apps){
			if(this.ready[app]){
				// app already registered!
			}else{
				this.ready[app] = apps[app];
				this.ready[app].channels = {};
				this.ready[app]._subs = [];
				this.ready[app]._active = false;
				dojo.mixin(this.ready[app],{'sub':this._mixin_sub,'activate':this._mixin_activate,'sort':this._mixin_sort});
				this.ready[app].library = new dojo.store.Memory();
			}
		}
	},
	get:function(url){
		dojo.xhrGet({
			url: url,
			load: function(response){
				eval(response);
				apps.activate();
			},
			error: function(response) {
				console.error("ERROR:", response);
			}
		});
	}
};


/**
 *  HOOKS:
 *  pre_unsubscribe
 *  post_unsubscribe
 *  pre_publish
 *  post_publish
 * 
 * 	pipe.events == {'subscribe':1,'unsubscribe':2,'publish':4,'unpublish':8}
 *  pipe.status == 
 * 
 * 	apps.hook({'channels':i,'event':pipe.events.subscribe,'state':pipe.state.post,'obj':'myObj.func'});
 */
//TODO: make a lot of these functions mixins
var channel = function(raw){
	this.id = raw['id'];
	this.name = raw['name'];
	this.path = raw['path'];
	this.description = raw['description'];
	this.subscribed = false;
	this.withMeta = false;
	this.metaSubscribers = [];
	this._callbacks = {};
	this.library = new dojo.store.Memory();
	this._handle = false;
	this.tree = {};
	this._hooks = { 0 : [{},{}],
					1: [{},{}],
					2: [{},{}],
					4: [{},{}],
					8: [{},{}]};
	this._fire_hook = function(event,state,arg,clear){
		var reset = false;
		for(e in this._hooks[event][state]){
			if(this._hooks[event][state][e].ready){
				// get valid dijit
				var d = dijit.byId(this._hooks[event][state][e].obj);
				// get valid app
				if(d == undefined){
					d = apps.ready[this._hooks[event][state][e].obj];
				}
				// get valid js object
				if(d == undefined){
					d = window[this._hooks[event][state][e].obj];
				}
				// or delete object for garbage collection
				if(d == undefined){
					delete this._hooks[event][state][e];
				}else{
					// then fire hook
					this._hooks[event][state][e].ready = false;
					d[this._hooks[event][state][e].func](this._hooks[event][state][e],arg);
					reset = true;
				}
			}
		}
		if(reset){
			this._clear_hook(event,state);
			if(isDebug){console.log('hooks clean');}
		}
	}
	this._clear_hook = function(event,state){
		for(e in this._hooks[event][state]){
			this._hooks[event][state][e].ready = true;
		}
	},
	this.publish = function(data, announce){
		if(isDebug){console.info('publishing channel: '+this.path);}
		if(announce == undefined){ announce = true; }
		var authToPub = true;
		if(announce){
			pipe.send(pipe.urls.send, data);
			authToPub = false;
		}//TODO: why dont i use else{ ???
		if(authToPub){
			dojo.publish('pubsub/'+this.path, [data]);
		}
	},
	this.publishMeta = function(data){
		// fire pre meta hook
		this._fire_hook(PUBSUB.EVENTS.META_UPDATE, PUBSUB.STATE.PRE, this);
		if(data.users){
			var post = false;
			this.metaSubscribers = data.users
			var getUsers = [];
			for(var u in this.metaSubscribers){
				if(!pipe.users[this.metaSubscribers[u]]){
					getUsers.push(this.metaSubscribers[u]);
				}
			}
			if(getUsers.length != 0){
				var _c = this;
				pipe.send(	pipe.urls.cmd,
							{"cmd":"getUserInfo","ids":getUsers.join()},
							{onLoad:function(b){_c._fire_hook(PUBSUB.EVENTS.META_UPDATE, PUBSUB.STATE.POST, _c);},type:PUBSUB.CALLBACKS.USER});
			}else{
				var post = true;				
			}
		}else if(data.name){
			this.name = data.name;
			var post = true;
		}else if(data.description){
			this.description = data.description;
			var post = true;
		}
		if(post){
			// fire post meta hook
			this._fire_hook(PUBSUB.EVENTS.META_UPDATE, PUBSUB.STATE.POST, this);
		}else{
			//apps.onError(PUBSUB.ERR_MESSAGE.INVALID_META);
			//fire error message
		}
	},
	this._sub = function(args){
		this.subscribed = args.sub;
		if(args.sub){
			this._handle = dojo.subscribe('pubsub/'+this.id, function(data){ /*console.log(data)*/ });
		}else{
			dojo.unsubscribe(this._handle);
		}
		if(args.announce){
			this._sendSubReq(args);
		}
		items = this.library.query();
		for (var ind in items){
			var d = dijit.byId(items[ind].id);
			if(d){d.weighChannel();}
		}
		// TODO: write subscribe xhr here
		// pass in announce, check if we need to reach out and request
		// or if it has been assigned from a page load
	}
	this.subscribe = function(args){
		if(typeof args != 'object'){args = {};}
		this._fire_hook(PUBSUB.EVENTS.SUBSCRIBE, PUBSUB.STATE.PRE, this);
		if(!this.subscribed){
			if(!args.announce){args.announce = true;}
			args.sub = true;
			this._sub(args);
		}
		this._fire_hook(PUBSUB.EVENTS.SUBSCRIBE, PUBSUB.STATE.POST, this);
	}
	this.unsubscribe = function(args){
		if(typeof args != 'object'){args = {};}
		this._fire_hook(PUBSUB.EVENTS.UNSUBSCRIBE, PUBSUB.STATE.PRE, this);
		if(this.subscribed){
			if(!args.announce){args.announce = true;}
			args.sub = false;
			this._sub(args);
		}
		this._fire_hook(PUBSUB.EVENTS.UNSUBSCRIBE, PUBSUB.STATE.POST, this);
	}
	this._sendSubReq = function(args){
		//subUrl = (sub) ? pipe.urls.subscribe : pipe.urls.unsubscribe;
		cmd = (args.sub) ? 'subscribe' : 'unsubscribe';
		var sendArgs = {channel:this.path,cmd:cmd};
		sendArgs.withMeta = (args.withMeta) ? true : false;
		this.withMeta = sendArgs.withMeta;
	    pipe.send(	pipe.urls.send,
	    			sendArgs,
	    			{onLoad:function(response) {if(response['error']){console.error('error: '+response['error']);}},type:PUBSUB.CALLBACKS.SUBSCRIBE|PUBSUB.CALLBACKS.UNSUBSCRIBE}
	    );
	}
}

var pipe = {
	errorSleepTime: 500,
	channels:{},
	_retryTimeout:[],
	users:{},
	_cTree:{},
	urls:{},
	_poll:false,
	_socket:false,
	callbacks:[],
	active:false,
	connectOnReady:false,
	inRetry:false,
	rl:0,
//	isXSite:false,
//	useWebsockets:true,
	session_id:dojox.encoding.digests.MD5(getCookie('user') + Math.round((new Date()).getTime()),dojox.encoding.digests.outputTypes.Hex),
	init:function(params,onReady){
		pipe.rl=1;
		var i = PUBSUB.CALLBACKS.ANY+1;
		while(i--){
			pipe.callbacks[i] = [];
		}
		
		pipe.onReady = (onReady) ? onReady : function(){};
		if(params['urls'] == undefined){
			console.error('missing required params in pipe');
		}
		pipe.urls = params['urls'];
		if(pipe.urls.home == 'undefined'){
			pipe.urls.home = '/';
		}
		if(pipe.urls.auth && !getCookie('user')){
			pipe.redirect(pipe.urls.auth);
		}
		pipe.useWebsockets = ("WebSocket" in window && pipe.urls.socket) ? true : false;
		pipe.connectOnReady = (params['connectOnReady']) ? true : false;
		pipe.noopInterval = (params['noopInterval']) ? (params['noopInterval']+60)*1000 : false;
		pipe.isXSite = (params['isXSite']) ? params['isXSite'] : false;

		if(pipe.useWebsockets){
			var cType = 'websocket';
		}else{
			if(pipe.isXSite){
				var cType = 'jsonp';
			}else{
				var cType = 'http';
			}
		}
		dojo.mixin(pipe,_pipe_mixins[cType]);
		if(params['channels']){
			for(chan in params['channels']){
				pipe.addChannel(params['channels'][chan]);
			}
			pipe._postInit(pipe.onReady);
		}else{
			pipe.send(pipe.urls.send, {'cmd':'getChannelList'},{
				onLoad:function(item){pipe._addChannelList(item);},
				type:PUBSUB.CALLBACKS.CHANNEL
			});
		}
	},
	getChannelList:function(){
		pipe.send(pipe.urls.send, {'cmd':'getChannelList'},{
			onLoad:function(item){pipe._addChannelList(item);},
			type:PUBSUB.CALLBACKS.CHANNEL
		});
	},
	_addChannelList:function(list){
		for(var i in list['channels']){
			if(pipe.channels[list['channels'][i].path] == undefined){
				pipe.addChannel(list['channels'][i]);
			}
		}
		if(pipe.rl <= 1 ){
			pipe._postInit(pipe.onReady);
		}
	},
	_postInit:function(onReady){
		pipe.active = true;
		if(pipe.connectOnReady){
			pipe.connect();
		}
		onReady();
		pipe.rl=2;
	},
	lostConnection:function(){
		apps.onError(PUBSUB.ERR_MESSAGE.CONNECTION_FAILED);
		pipe.inRetry = true;
	},
	regainConnetion:function(){
		apps.onErrorClear(PUBSUB.SYS_MESSAGE.CONNECTION_RESTORED);
		pipe.inRetry = false;
	},
	refreshCurrentChannels:function(){
		if(isDebug){ console.info("resubscribing to channels"); }
		var paths = [];
		paths[false] = '';	//noMeta
		paths[true] = '';	//withMeta
		for(var i in pipe.channels){
			if(pipe.channels[i].subscribed){
				if(paths[pipe.channels[i].withMeta] != ''){paths[pipe.channels[i].withMeta]+=',';}
				paths[pipe.channels[i].withMeta] += pipe.channels[i].path;
			}
		}
		for(var i in paths){
			if(paths[i] != ''){
				pipe.send(pipe.urls.send, {'channel':paths[i],'cmd':'subscribe','withMeta':i}, {
					onLoad:function(response){if(response['error']){console.error('error: '+response['error']);}},
					type:PUBSUB.CALLBACKS.SUBSCRIBE|PUBSUB.CALLBACKS.UNSUBSCRIBE
			    });
			}
		}
	},
	onSuccess:function(response){
    	if(pipe.inRetry){
    		pipe.regainConnetion();
    		pipe.refreshCurrentChannels();
    	}
		pipe._poll = false;
		pipe.errorSleepTime = 2000;
    },
    onError:function(response){
		pipe._poll = false;
    	if(!pipe.inRetry){
    		pipe.lostConnection();
    	}
		if(pipe.errorSleepTime < 120000){
			pipe.errorSleepTime *= 2;
		}
		if(isDebug){ console.error("connect error; sleeping for", pipe.errorSleepTime, "ms"); }
		window.setTimeout(pipe.connect, pipe.errorSleepTime);
    },
	addChannel:function(raw){
		this.channels[raw['path']] = new channel(raw);
		var tree = raw['path'].split('/');
		var cTree = this._cTree;
		var _t = {};
		var _tr = _t;
		for(var i in tree){
			if(cTree[tree[i]] == undefined){
				cTree[tree[i]] = {};
			}
			_t[tree[i]] = {};
			_t = _t[tree[i]];
			cTree = cTree[tree[i]];
		}
		this.channels[raw['path']].tree = _tr;
		if(raw['users']){
			this.channels[raw['path']].publishMeta({users:raw['users']})
		}
	},
	subscribed:function(){
		var r = [];
		for(chan in this.channels){
			if(this.channels[chan['subscribed']]){
				r.push(this.channels[chan]);
			}
		}
		return r;
	},
	receive:function(data){
		//pipe._runCallbacks(data);
		if(data.cmd){
			return this.cmd(data.messages, data.cmd);
		}else if(data.messages){
            for(message in data.messages){
            	for(chan in data.messages[message].channels){
        			this.channels[data.messages[message].channels[chan]].publish(data.messages[message], false);
        		}
        	}
			pipe.runCallback(PUBSUB.CALLBACKS.CHANNEL_ITEM,data);
            return true;
		}else if(data.ok){
			return true;
		}else if(data.meta){
			if(data.meta.channel){
				pipe.channels[data.meta.channel].publishMeta(data.meta.meta);
				pipe.runCallback(PUBSUB.CALLBACKS.META,data.meta.meta);
			}
		}else if(data.channels){
			pipe._addChannelList(data);
			pipe.runCallback(PUBSUB.CALLBACKS.CHANNEL,data);			
			return true;
		}else if(data.response){
			pipe.response(data);
        }else{
        	return false;
        }
	},
	response:function(d){
		if(isDebug){console.log('RESPONSE: ',d.type)};
		switch(d.type){
			case 'subscribe':
				for(var i in d.response){
					pipe.channels[d.response[i].path].description = d.response[i].description;
					pipe.channels[d.response[i].path].name = d.response[i].name;
					pipe.channels[d.response[i].path].metaSubscribers = d.response[i].users;
					var getUsers = [];
					for(var u in d.response[i].users){
						if(!pipe.users[d.response[i].users[u]]){
							getUsers.push(d.response[i].users[u]);
						}
					}
					if(getUsers.length != 0){
						var _c = pipe.channels[d.response[i].path];
						pipe.send(	pipe.urls.cmd,
									{"cmd":"getUserInfo","ids":getUsers.join()},
									{onLoad:function(b){_c._fire_hook(PUBSUB.EVENTS.META_UPDATE, PUBSUB.STATE.POST, _c);},type:PUBSUB.CALLBACKS.USER});
					}else{
						pipe.channels[d.response[i].path]._fire_hook(PUBSUB.EVENTS.META_UPDATE, PUBSUB.STATE.POST, pipe.channels[d.response[i].path]);
					}
				}
				pipe.runCallback(PUBSUB.CALLBACKS.SUBSCRIBE,d.response);
				break;
			case 'unsubscribe':
				pipe.runCallback(PUBSUB.CALLBACKS.UNSUBSCRIBE,d.response);
				break;
			case 'users':
				for(var i in d.response){
					pipe.users[d.response[i].pid] = d.response[i]
					if (d.response[i].uid && d.response[i].uid == pipe.session_id){
						pipe.me = d.response[i];
					}
				}
				pipe.runCallback(PUBSUB.CALLBACKS.USER,d.response);
		}
	},
	cmd:function(message, cmd){
		if(isDebug){console.log('COMMAND: ',cmd)};
		switch(cmd){
			case 'done':
				pipe.active = false;
				pipe._poll = false;
				pipe.send = function(){};
				break;
			case 'refresh':
				pipe.active = false;
				pipe.redirect(pipe.urls.home);
			case 'getChannelList':
				pipe.getChannelList();
			case 'noop':
				break;
			case 'pong':
				break;
		}
		return true;
	},
	errorMessage:function(data){
		if(data['redirect']){ pipe.redirect(data['redirect']); }
	},
	redirect:function(uri){
		window.location = uri;
	},
	addCallback:function(cb,func){
		if(isDebug){console.log('ADDING CALLBACK FOR '+cb);}
		pipe.callbacks[cb].push(func);
	},
	runCallback:function(cb,val){
		if(isDebug){console.log('RUNNING CALLBACKS FOR '+cb);}
		for(var i in pipe.callbacks){
			if(cb&i){
				while(pipe.callbacks[i].length){
					func = pipe.callbacks[i].shift();
					func(val);
				}
			}
		}
	}
}

_pipe_mixins = {
		'websocket':{
			send:function(url, args, cb, onError){
				// TODO: handle onError
				if(pipe.session_id){args.session_id = pipe.session_id;}
				if(pipe._socket == false){
					// TODO: also need to include onSuccess if passed in.
					var func = {onLoad:function(){pipe._socket.send(dojo.toJson(args))},type:PUBSUB.CALLBACKS.ANY};
					pipe.connect(func);
				}else{
					if(typeof cb == 'function'){
						console.error('DEPRECATED: onSuccess (as function) in pipe.send is deprecated.  use {onLoad:function(),onError:function(),type:PUBSUB.CALLBACKS.ANY}');
						cb = {onLoad:cb,type:PUBSUB.CALLBACKS.ANY}
					}
					if(cb && cb.onLoad){
						pipe.addCallback(cb.type || PUBSUB.CALLBACKS.ANY, cb.onLoad)
					}
					if(pipe._socket.readyState == pipe._socket.OPEN){
						pipe._socket.send(dojo.toJson(args));
					}
				}
			},
			connect:function(cb){
				if(pipe._socket == false || pipe._socket.readyState != pipe._socket.OPEN){
					if(typeof cb == 'function'){
						console.error('DEPRECATED: callback (as function) in pipe.send is deprecated.  use {onLoad:function(),onError:function(),type:PUBSUB.CALLBACKS.ANY}');
						cb = {onLoad:cb,type:PUBSUB.CALLBACKS.ANY}
					}
					if(cb && cb.onLoad){
						pipe.addCallback(cb.type || PUBSUB.CALLBACKS.ANY, cb.onLoad)
					}
					pipe._socket = new WebSocket('ws://'+window.location.host+pipe.urls.socket+'/'+pipe.session_id);
					pipe._socket.onopen = pipe.onOpen;
					pipe._socket.onmessage = pipe.onMessage;
					pipe._socket.onclose = pipe.onClose;
					pipe._socket.onerror = pipe.onTimeout;
				}else{
					/* TODO: not sure if i want this
					if(cb.onLoad){
						pipe.addCallback(cb.type || PUBSUB.CALLBACKS.ANY, cb.onLoad)
					}
					*/
				}
			},
			onOpen:function(){
				pipe.runCallback(PUBSUB.CALLBACKS.UNSUBSCRIBE);
				for (var i in pipe._retryTimeout){
					clearTimeout(pipe._retryTimeout[i])
				}
				pipe._retryTimeout = [];
			},
			onMessage:function(message){
				pipe._socket.lastTime = Math.round((new Date()).getTime() / 1000);
				pipe.noopCheck();
				var response = message.data;
				if(response == ""){pipe.onError(response); return false;}
				var _re = dojo.fromJson(response);
				if(isDebug){console.dir(_re);}
				if( pipe.receive(_re) ){
					pipe.onSuccess(_re);
				}else{
					//pipe._runCallbacks(_re);
					pipe.errorMessage(_re);
				}
			},
			onClose:function(close){
				//pipe.onTimeout();
			},
			onTimeout:function(e){
				if(pipe._socket.readyState == pipe._socket.OPEN){
					pipe.close();
				}
		    	if(!pipe.inRetry){
		    		pipe.lostConnection();
		    	}
				if(pipe.errorSleepTime < 120000){
					pipe.errorSleepTime *= 2;
				}
				var _rt = window.setTimeout(function(){pipe.connect();}, pipe.errorSleepTime);
				pipe._retryTimeout.push(_rt);
				if(isDebug){ console.error("Connect error; sleeping for", pipe.errorSleepTime, "ms"); }
			},
			noopCheck:function(){
				clearTimeout(pipe._socket.noopTimeout);
				pipe._socket.noopTimeout = setTimeout(pipe.onTimeout,pipe.noopInterval);
			},
			close:function(){
				pipe._socket.close();
			},
		},
		'http':{
			send:function(url, args, onSuccess, onError){
				args = {'m':dojo.toJson(args)};
				if(pipe.session_id){args.session_id = pipe.session_id;}
				if(!onSuccess){ onSuccess = function(response){} }
				if(!onError){ onError = function(response){} }
				var xhrArgs = {
					url: url,
					content: args,
					load: function(response){
						if(response == ""){pipe.onError(response); return false;}
						var _re = dojo.fromJson(response);
						if(isDebug){console.dir(_re);}
						if( pipe.receive(_re) ){
							onSuccess(_re);
						}else{
							pipe.errorMessage(_re);
						}
					},
					error: function(err,xhrobj){
						if(err.dojoType == 'timeout'){
							pipe.onTimeout();
						}else{
							pipe.onError(err);
							return false;
						}
					},
					timeout:pipe.noopInterval
				}
			    return dojo.xhrPost(xhrArgs);
			},
			connect:function(){
				if(typeof pipe._poll != 'object' && pipe.active == true){
					var args = {};
					pipe._poll = pipe.send(pipe.urls.poll, args, function(){pipe.onSuccess(); pipe.connect();}, pipe.onError);

					if(pipe.inRetry){
						pipe.refreshCurrentChannels();
					}
				}
			},
		    onTimeout:function(){
				_poll = pipe._poll;
				pipe._poll = false;
				if(_poll.fired < 1 && _poll.canceled != true){
					//_poll.cancel();
				}
		    	if(!pipe.inRetry){
		    		pipe.lostConnection();
		    	}
				if(pipe.errorSleepTime < 120000){
					pipe.errorSleepTime *= 2;
				}
				if(isDebug){ console.error("Connect error; sleeping for", pipe.errorSleepTime, "ms"); }
				window.setTimeout(pipe.connect, pipe.errorSleepTime);
			}
		},
		'jsonp':{
			send:function(url, args, onSuccess, onError){
				if(pipe.session_id){args.session_id = pipe.session_id;}
				if(!onSuccess){ onSuccess = function(response){} }
				if(!onError){ onError = function(response){} }
			    var deferred = dojo.io.script.get({
			        url: url,
			        callbackParamName: "callback",
			        content: args,
					timeout:pipe.noopInterval,
					handle: function(response, ioArgs){
						if(response instanceof Error){
							if(response.dojoType == 'timeout'){
								pipe.onTimeout();
								return true;
							}else{
								pipe.onError(err);
								return false;
							}
						}
					}
			    });
			    deferred.then(function(response){
					if(response == ""){pipe.onError(response); return false;}
					var _re = response;
					if(isDebug){console.dir(_re);}
					if( pipe.receive(_re) ){
						onSuccess(_re);
					}else{
						pipe.errorMessage(_re);
					}
			    });
			    return deferred;
			}
		}
}

