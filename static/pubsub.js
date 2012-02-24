/***
 * pubsub.js
 */
// show debug info in console
var isDebug = false;

function onCheck(a){(a)?pipe.channels[this.name].subscribe():pipe.channels[this.name].unsubscribe();}
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
	mixin_sub:function(channels, callback){
		if((typeof channels) == 'string'){ channels = [channels]; }
		var me = this;
		_cb = function(m){
			if((typeof m['_admin']) == 'function'){
				m['_admin'](m);
			}else{
				me[callback](m);
				me.library.put(m,m.id);
			}
		}
		for(channel in channels){
			// match if not '*'
			if(channels[channel].indexOf('*') > 0){
				for(_ch in pipe.channels){
					if(pipe.channels[_ch].path.match(channels[channel]) != ''){
						this._subs.push(dojo.subscribe(pipe.channels[_ch].path, _cb));
						this.channels[pipe.channels[_ch].path] = pipe.channels[_ch];
					}
				}
			}else{
				this._subs.push(dojo.subscribe(pipe.channels[_ch].path, _cb));
				this.channels[pipe.channels[_ch].path] = pipe.channels[_ch];
			}
		}
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
var channel = function(raw){
	this.id = raw['id'];
	this.name = raw['name'];
	this.path = raw['path'];
	this.description = raw['description'];
	this.subscribed = false;
	this.cursor = '';
	//this.library = {};
	this.library = new dojo.store.Memory();
	this._handle = false;
	this.checkBox = false;
	this.tree = {};
	this.publish = function(data, announce){
		if(isDebug){console.info('publishing channel: '+this.path);}
		if((typeof announce) == 'undefined'){ announce = true; }
		var authToPub = true;
		if(announce){
			var _resp = function(response){console.log(response);}
			pipe.send(pipe.urls.new, data, _resp);
			authToPub = false;
		}
		if(authToPub){
			dojo.publish(this.path, [data]);
		}
	}
	this._sub = function(sub, announce){
		this.subscribed = sub;
		if(sub){
			this._handle = dojo.subscribe(this.id, function(data){ console.log(data) });
		}else{
			dojo.unsubscribe(this._handle);
		}
		if(this.checkBox){
			this.checkBox.set('checked',this.subscribed);
		}
		if(announce){
			this._sendSubReq(sub);			
		}
		this.library.query().forEach(function(item){dijit.byId(item.id).weighChannel();});
		
		// TODO: write subscrbie xhr here
		// pass in announce, check if we need to reach out and requesst
		// or if it has been assigned from a page load
	}
	this.subscribe = function(announce){
		if((typeof announce) == 'undefined'){announce = true;}
		this._sub(true,announce);
	}
	this.unsubscribe = function(announce){
		if((typeof announce) == 'undefined'){announce = true;}
		//dojo.publish(this.path, [{'_admin':_unSub,'channel':this}]);
		this._sub(false,announce);
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
	init:function(params){
		if((typeof params['urls'] == 'undefined')){
			console.error('missing required params in pipe');
		}
		pipe.urls = params['urls'];
		
		for(chan in channels){
			pipe.addChannel(channels[chan]);
		}
	},
	poll: function() {
		console.log(pipe._poll,typeof pipe._poll);
		if(typeof pipe._poll != 'object'){
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
			error: function(response) {
				console.error("ERROR:", response);
				onError(_re);
			}
		}
	    return dojo.xhrPost(xhrArgs);
	},
	receive:function(data){
        if(data.messages){
            for(message in data.messages){
            	for(chan in data.messages[message].channels){
        			this.channels[data.messages[message].channels[chan]].publish(data.messages[message], false);
        		}
        	}
            return true;
        }else{
        	return false;
        }
	},
	errorMessage:function(data){
		if(data['redirect']){ pipe.redirect(data['redirect']); }
	},
	redirect:function(uri){
		window.location = uri;
	}
}