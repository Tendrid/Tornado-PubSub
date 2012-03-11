/***
 * pubsub.js
 */
// show debug info in console
var isDebug = false;

function getCookie(name) {var r = document.cookie.match("\\b" + name + "=([^;]*)\\b"); return r ? r[1] : undefined;}
Object.size = function(obj) { var size = 0, key; for (key in obj) { if (obj.hasOwnProperty(key)) size++; } return size; }
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
	activate:function(){
		for(var app in this.ready){
			if(this.ready[app].activate){this.ready[app].activate();}
		}
	},
	_match:function(channels){
		var _out = [];
		if((typeof channels) == 'string'){ channels = [channels]; }
		for(channel in channels){
			// match if not '*'
			if(channels[channel].indexOf('*') > 0){
				for(_ch in pipe.channels){
					if(pipe.channels[_ch].path.match(channels[channel]) != ''){
						_out.push(pipe.channels[_ch]);
					}
				}
			}else{
				_out.push(pipe.channels[channels[channel]]);
			}
		}
		return _out;
	},
	/**
	 * Fired under the scope of the created app
	 */
	mixin_sub:function(channels, callback){
		var me = this;
		_cb = function(m){
			if(typeof m == 'undefined'){
				console.log('broken');
			}
			me[callback](m);
			me.library.put(m,{'id':m.id});
		}
		var chan = apps._match(channels);
		for(var ind in chan){
			this._subs.push(dojo.subscribe(chan[ind].path, _cb));
			this.channels[chan[ind].path] = chan[ind];
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
				dojo.mixin(this.ready[app],{'sub':this.mixin_sub});
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

/*** 
 *sub('root/*', callback, optional_Trackarray);
 */
/*
function _unSub(m){
	console.log('UNSUB FIRED: ',m.channel.path);
	//downgrade (channelWeight -=(1 / chan.length)) per channel item
}
*/

var PUBSUB = {
	EVENTS:{'SUBSCRIBE':0,'UNSUBSCRIBE':1,'PUBLISH':2,'UNPUBLISH':4},
	STATE:{'PRE':0,'POST':1}
}

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
	this.cursor = '';
	//this.library = {};
	this._callbacks = {};
	this.library = new dojo.store.Memory();
	this._handle = false;
	this.tree = {};
	this._hooks = { 0 : [{},{}],
					1: [{},{}],
					2: [{},{}],
					4: [{},{}] };
	this._fire_hook = function(event,state,arg,clear){
		var reset = false;
		for(e in this._hooks[event][state]){
			if(this._hooks[event][state][e].ready){
				// get valid dijit
				var d = dijit.byId(this._hooks[event][state][e].obj);
				// get valid app
				if(typeof d == 'undefined'){
					d = apps.ready[this._hooks[event][state][e].obj];
				}
				// get valid js object
				if(typeof d == 'undefined'){
					d = window[this._hooks[event][state][e].obj];
				}
				// or delete object for garbage collection
				if(typeof d == 'undefined'){
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
		if((typeof announce) == 'undefined'){ announce = true; }
		var authToPub = true;
		if(announce){
			var _resp = function(response){console.log('hit');}
			pipe.send(pipe.urls.publish, data, _resp);
			//alert('post');
			authToPub = false;
		}
		if(authToPub){
			dojo.publish(this.path, [data]);
		}
	},
	this._sub = function(sub, announce){
		this.subscribed = sub;
		if(sub){
			this._handle = dojo.subscribe(this.id, function(data){ /*console.log(data)*/ });
		}else{
			dojo.unsubscribe(this._handle);
		}
		if(announce){
			this._sendSubReq(sub);			
		}
		items = this.library.query();
		for (var ind in items){
			//if(sub){console.log(items[ind]);this.publish(items[ind],false);}
			var d = dijit.byId(items[ind].id);
			if(d){d.weighChannel();}
		}
		/*
		this.library.query().forEach(function(item,a,b,c,d){
			// TODO: we need to destory these so we dont have memory leaks and sort issues
			if(sub){
				cls.publish(item,false);
			}
			var d = dijit.byId(item.id);
			if(d){d.weighChannel();}
		});
		*/
		// TODO: write subscrbie xhr here
		// pass in announce, check if we need to reach out and requesst
		// or if it has been assigned from a page load
	}
	this.subscribe = function(announce){
		this._fire_hook(PUBSUB.EVENTS.SUBSCRIBE, PUBSUB.STATE.PRE, this);
		if(!this.subscribed){
			if((typeof announce) == 'undefined'){announce = true;}
			this._sub(true,announce);
		}
		this._fire_hook(PUBSUB.EVENTS.SUBSCRIBE, PUBSUB.STATE.POST, this);
		//this._clear_hook(PUBSUB.EVENTS.SUBSCRIBE, PUBSUB.STATE.PRE);
		//this._clear_hook(PUBSUB.EVENTS.SUBSCRIBE, PUBSUB.STATE.POST);
	}
	this.unsubscribe = function(announce){
		this._fire_hook(PUBSUB.EVENTS.UNSUBSCRIBE, PUBSUB.STATE.PRE, this);
		if(this.subscribed){
			if((typeof announce) == 'undefined'){announce = true;}
			this._sub(false,announce);
		}
		this._fire_hook(PUBSUB.EVENTS.UNSUBSCRIBE, PUBSUB.STATE.POST, this);
		//this._clear_hook(PUBSUB.EVENTS.UNSUBSCRIBE, PUBSUB.STATE.PRE);
		//this._clear_hook(PUBSUB.EVENTS.UNSUBSCRIBE, PUBSUB.STATE.POST);
	}
	this._sendSubReq = function(sub){
		subUrl = (sub) ? pipe.urls.subscribe : pipe.urls.unsubscribe;
	    pipe.send(subUrl, {'channel':this.path}, function(response) {
	    	if(response['error']){
	    		console.error('error: '+response['error']);
	    	}
	    });
	}
}

var pipe = {
	errorSleepTime: 5000000,
	channels:{},
	chanStore:false,
	_cTree:{},
	urls:{},
	_poll:false,
	active:false,
	init:function(params){
		if((typeof params['urls'] == 'undefined')){
			console.error('missing required params in pipe');
		}
		pipe.urls = params['urls'];
		
		for(chan in channels){
			pipe.addChannel(channels[chan]);
		}
		pipe.active = true;
	},
	poll: function() {
		if(typeof pipe._poll != 'object' && pipe.active == true){
			var args = {};
			pipe._poll = pipe.send(pipe.urls.poll, args, pipe.onSuccess, pipe.onError);
		}
	},
	onSuccess: function(response){
		pipe._poll = false;
		//pipe.errorSleepTime = 500;
		window.setTimeout(pipe.poll, 0);
    },
    onError: function(response){
		pipe._poll = false;
        this.errorSleepTime *= 2;
        console.error("Poll error; sleeping for", this.errorSleepTime, "ms");
        window.setTimeout(pipe.poll, pipe.errorSleepTime);
    },
	addChannel:function(raw){
		this.channels[raw['path']] = new channel(raw);
		var tree = raw['path'].split('/');
		var cTree = this._cTree;
		var _t = {};
		var _tr = _t;
		for(var i in tree){
			if(typeof cTree[tree[i]] == 'undefined'){
				cTree[tree[i]] = {};
			}
			_t[tree[i]] = {};
			_t = _t[tree[i]];
			cTree = cTree[tree[i]];
		}
		this.channels[raw['path']].tree = _tr;
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
	send:function(url, args, onSuccess, onError){
		//args._xsrf = getCookie("_xsrf");
		if(!onSuccess){ onSuccess = function(response){} }
		if(!onError){ onError = function(response){} }
		var xhrArgs = {
			url: url,
			content: args,
			load: function(response){
				var _re = dojo.fromJson(response);
				if(isDebug){console.dir(_re);}
				if( pipe.receive(_re) ){
					onSuccess(_re);
				}else{
					pipe.errorMessage(_re);
				}
			},
			error: function(err,xhrobj) {
				console.error("ERROR:", err,xhrobj);
				//onError(response);
			}
		}
	    return dojo.xhrPost(xhrArgs);
	},
	receive:function(data){
		if(data.cmd){
			return this.cmd(data.messages, data.cmd);
		}else if(data.messages){
            for(message in data.messages){
            	for(chan in data.messages[message].channels){
        			this.channels[data.messages[message].channels[chan]].publish(data.messages[message], false);
        		}
        	}
            return true;
		}else if(data.ok){
			return true;
        }else{
        	return false;
        }
	},
	cmd:function(message, cmd){
		console.log('COMMAND: ',cmd);
		if(cmd == 'done'){
			pipe.active = false;
			pipe._poll = false;
		}
		return true;
	},
	errorMessage:function(data){
		if(data['redirect']){ pipe.redirect(data['redirect']); }
	},
	redirect:function(uri){
		//console.log('REDIRECT: '+url)
		//window.location = uri;
	}
}