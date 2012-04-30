import logging
import settings
import uuid
import tornado.web
import time
import datetime

class PubSub(object):
    channels = {}
    master_list = {}
    db = None
    chan_set = {}
    _gate = {}
    _collections = {}
    users = {}
    _user_pid_map = {}
    _engines = {}
    _rl = 0

    def __new__(cls, instance='default', *args, **kwargs):
        try:
            cls._engines[instance]
            return cls._engines[instance]
        except KeyError:
            cls._engines[instance] = super(PubSub, cls).__new__(cls, *args, **kwargs)
            return cls._engines[instance]
   
    @classmethod
    def connect(cls,id):
        try:
            return cls._collections[id]
        except:
            #todo: try to load collection from db, then fail
            return None

    class _conn(object):
        def __init__(self,raw):
            self.gate = PubSub._gate[raw['gate']]
            self.loc = raw['loc']
            self.db = self.gate.db()
            self.id = raw.id

    def start(self):
        self._rl = 1
        self._buildGates()
        self._buildCallbacks()
        self.loadChannels()
        self._rl = 2
    
    def _buildGates(self):
        for comm in __import__("gates.__init__").__all__:
            self._gate[comm] = __import__("gates.{0}".format(comm),None,None,'*')
        coll = self._gate[settings.DEFAULT_STORAGE].db().getCollections()
        for collection in coll:
            self._collections[collection.id] = self._conn(collection)
        self.db = self._gate[settings.DEFAULT_STORAGE].db()

    def _buildCallbacks(self):
        # parent callback
        def func(cls,param):
            #todo: reference parent, adobt rules
            pass
        self.chan_set["parent"] = func
        
        # set channel history limit callback
        def func(cls,param):
            cls._setHistoryLimit(param)
        self.chan_set["historylimit"] = func
    
    """Loaders"""
    def preLoadData(self,collection_id,announce = False):
        try:
            col = self._collections[collection_id]
        except:
            #todo: handle this
            debug("FAILED TO LOAD COLLECTION")
            return None
        items = col.db.getChannelItems(col.loc,col.id)
        for row in items:
            try:
                self.channels[row['channel']].updateItem(row, collection_id, announce)
            except KeyError:
                self.loadChannels()
                self.channels[row['channel']].updateItem(row, collection_id, announce)

    """BETA"""
    def loadChannels(self):
        rows = self.db.getChannels()
        for row in rows:
            if row['channel'] not in self.channels:
                debug('adding channel {0}'.format(row['channel']))
                self.channels[row['channel']] = Channel(row)
        return self.channels
    
    def killUser(self,uid):
        self.users[uid].destroy()
        del self.users[uid]
    def addUser(self,user):
        self.users[user.uid] = user
        try:
            self._user_pid_map[user.pid].append(user.uid)
        except KeyError:
            self._user_pid_map[user.pid] = [user.uid]
        return user
    def userByPid(self,pid):
        try:
            sid = self._user_pid_map[pid]
        except:
            #unkown user
            return []
        try:
            users = []
            for u in sid:
                users.append(self.users[u])
            return users
        except:
            #known map, but user is gone
            del self._user_pid_map[pid]
            return []
        
    
    def createChannelItem(self,raw,channels,collection_id):
        raw['channels'] = channels
        channel_ids = []
        raw['collection_id'] = collection_id
        for chan in channels:
            channel_ids.append(PubSub.channels[chan].id)
        id = self._collections[collection_id].db.putChannelItem(self._collections[collection_id].loc,raw,channel_ids)
        raw['id'] = id
        ci = ChannelItem(raw)
        ci.update()
        return ci.toObj()

class Channel():

    def __init__(self, raw):
        self.subscribers = []
        self.metaSubscribers = []
        self.history = []
        self.library = {}
        self.history_limit = None
        self.id = str(raw['id'])
        self.path = str(raw['channel'])
        self.name = str(raw['name'])
        self.description = str(raw['description'])

        #inits:
        self._config(raw['config'])
        
    def _config(self,params):
        if params == None:
            return
        try:
            #TODO: dont use eval. security!
            params = eval(params)
        except:
            params = {}
        #default settings
        try:
            params['historylimit']
        except:
            params['historylimit'] = 25
        #load settings
        for param in params:
            if param in settings.CHANNEL_PARAMS:
                try:
                    PubSub.chan_set[param](self, params[param])
                except KeyError:
                    debug( "Channel callback {0} not set.".format(param))

    def _setHistoryLimit(self,limit):
        self.history_limit = limit
        self.cleanHistory()

    def cleanHistory(self):
        if self.history_limit:
            limit = self.history_limit
            while len(self.library) > limit:
                last = self.history.pop()
                k = last[1]
                for item in [item for item in self.history if item[1] is k]:
                    # watch for items left behind that have been edited
                    del item
                    #del self.history[item]
                del self.library[k]
                try:
                    PubSub.master_list[k].removeChan(self.path)
                    if len(PubSub.master_list[k].channels) == 0:
                        del PubSub.master_list[k]
                except KeyError:
                    pass

    def _getMetaUserList(self):
        u = []
        #REMIX
        #for sid, user in self.subscribers.items():
        for sid in self.subscribers:
            u.append(PubSub.users[sid].pid)
        return u
    def setName(self,name):
        self.name = name
        self.sendMeta({'channel':self.path,'meta':{'name':name}})
    def setDescription(self,description):
        self.description = description
        self.sendMeta({'channel':self.path,'meta':{'description':description}})
    def sendMeta(self,msg):
        for u in self.metaSubscribers:
            PubSub.users[u].send(msg,'meta')
    def subscribe(self, user, withMeta=False):
        ul = self._getMetaUserList()
        #self.subscribers[user.id()] = user
        #REMIX
        if user.id() not in self.subscribers:
            self.subscribers.append(user.id())
        if user.pid not in ul:
            self.sendMeta({'channel':self.path,'meta':{'users':self._getMetaUserList()}})
        if withMeta:
            self.metaSubscribers.append(user.id())
        user.loadChannel(self.path)
        try:
            return self.history[0]
        except IndexError:
            return None
    def unsubscribe(self, user):
        try:
            #del self.subscribers[user.id()]
            #REMIX
            self.subscribers.remove(user.id())
        except KeyError:
            pass
        try:
            #del self.metaSubscribers[user.id()]
            #REMIX
            self.metaSubscribers.remove(user.id())
        except KeyError:
            pass
        if user.pid not in self._getMetaUserList():
            self.sendMeta({'channel':self.path,'meta':{'users':self._getMetaUserList()}})
        
    def publish(self, ChannelItem):
        self.library[ChannelItem.id] = ChannelItem
        self.addToHistory(ChannelItem)
        
        #users = self.subscribers.values()
        #REMIX
        users = self.subscribers
        for user in users:
            PubSub.users[user].getUpdate(self.path)
        return users
    def addToHistory(self, ci):
        self.history.insert(0,[str(uuid.uuid4()), ci.id])
        self.cleanHistory()
    def toDict(self):
        u = []

        #REMIX
        #self.subscribers
        #for sid, user in self.subscribers.items():
        for user in self.subscribers:
            u.append(PubSub.users[user].pid)
        return {'id':self.id,'path':self.path,'name':self.name,'description':self.description, 'users':u}
    
    def updateItem(self,raw,collection_id,announce=True):
        try:
            id = str(collection_id)+'_'+str(raw['id'])
            try:
                PubSub.master_list[id].update(raw,announce)
            except KeyError:
                PubSub.master_list[id] = ChannelItem(raw,announce)
                
            self.addToHistory(PubSub.master_list[id])
            self.library[id] = PubSub.master_list[id]
        except KeyError:
            pass


class ChannelItem():
    def __init__(self,raw,announce = False):
#        print 'new ci --------------------------------------------------------------------------------------------------'
        self._id = raw['id']
        self.id = str(raw['collection_id'])+'_'+str(raw['id'])
        self.data = {}
        self.channels = []
        self.update(raw.copy(),announce)
        self.collection = PubSub.connect(raw['collection_id'])
        PubSub.master_list[self.id] = self

    def update(self,raw=None,announce=True):
        if not raw:
            raw = self.getFromDB()
        for k,v in raw.items():
            self.attr(k,v)
        if announce:
            self.publish()
    def publish(self):
        users = []
        #loop through all channels
        for chan in self.channels:
            #get a list of users subscribed to channel
            for user_id in PubSub.channels[chan].publish(self):
                #users[user_id] = PubSub.users[user_id]
                users.append(user_id)
        #loop through users, execute queues
        for user_id in users:
            PubSub.users[user_id].runQueue()

    def getFromDB(self):
        rows = self.collection.db.getChannelItem(self.collection.loc,self._id)
        for row in rows:
            return row
    def attr(self,key,val=False):
        if val != False:
            if not val:
                val = ''
            if key == 'channel':
                self.addChan(val)
            else:
                self.data[key] = val
        try:
            if key == 'channel':
                return self.channels
            else:
                return self.data[key]
        except KeyError:
            return None
    def toObj(self):
        retVal = self.data
        retVal['id'] = self.id
        retVal['channels'] = []
        for chan in self.channels:
            retVal['channels'].append(chan)
        return retVal
    def addChan(self,channel):
        chan = PubSub.channels[channel]
        if chan.path not in self.channels:
            self.channels.append(chan.path)
    def removeChan(self,channel):
        for i,c in enumerate(self.channels):
            if c == channel:
                del self.channels[i]

class User():
    def __init__(self, raw, uid=None):
        self._buffer = []
        if uid:
            self.uid = uid
        else:
            try:
                self.uid = raw['uid']
            except KeyError:
                logging.warning("uid missing in user init")
                self.uid = str(uuid.uuid4())
        try:
            self.pid = raw['pid']
        except KeyError:
            logging.warning("pid missing in user init")
            self.pid = str(uuid.uuid4())
        self.raw = raw
        self.reset()
        self.times = {"lastPublished":0,"login":int(time.mktime(datetime.datetime.now().timetuple())),"lastUpdated" : int(time.mktime(datetime.datetime.now().timetuple()))}
    def waitForEvent(self, callback):
        if self.callback:
            self.noop()
        self.callback = callback  
        if self._buffer != []:
            b = self._buffer
            self._buffer = []
            self.send(b,'bufferFlush')
    def id(self):
        return self.uid
    def getTimes(self):
        return self.times
    def auth(self):
        #TODO: connect to db or whatever
        return true
    def send(self,msg=None,cmd=None):
        if self.callback:
            reset = self.callback(msg,cmd,self)
            self.times['lastUpdated'] = int(time.mktime(datetime.datetime.now().timetuple()))
        else:
            self._buffer.append(dict(msg=msg,cmd=cmd))
        if reset:
            self.callback = None
    def noop(self):
        dt = int(time.mktime(datetime.datetime.now().timetuple()))
        out = self.send(dt,'noop')
        return out
        """
        if self.callback:
            callback = self.callback;
            self.callback = None
            dt = int(time.mktime(datetime.datetime.now().timetuple()))
            out = callback(dt,'noop')
            self.times['lastUpdated'] = dt
            return out
        """
    def subscribe(self,channel,withMeta=False):
        try:
            debug( '{0} just subscribed to {1} (withMeta: {2})'.format(self.uid,channel,str(withMeta)))
            hist = PubSub.channels[channel].subscribe(self,withMeta)
            if channel not in self.channels:
                self.channels.append(channel)
            if withMeta:
                return PubSub.channels[channel].toDict()
            else:
                return dict(ok="subscribe ok")
        except KeyError:
            return dict(error='invalid channel: {0}'.format(channel))
    def unsubscribe(self,channel):
        try:
            debug( self.uid +' just unsubscribed to '+channel)
            PubSub.channels[channel].unsubscribe(self)
            return dict(ok="unsubscribe ok")
        except KeyError:
            return dict(error='invalid channel')
    def getChannelCursor(self,channel):
        try:
            return self.history[channel]
        except KeyError:
            return None
    def getUpdate(self,channel):
        cursor = self.getChannelCursor(channel)
#        print cursor
#        print PubSub.channels[channel].history
        try:
            mlist = {}
            c = PubSub.channels[channel]
            for item in c.history:
                if cursor == item[0]:
                    break
                try:
                    if not mlist[item[1]]:
                        mlist[item[1]] = c.library[item[1]]
                except KeyError:
                    mlist[item[1]] = c.library[item[1]]
            for item in mlist:
                if mlist[item] not in self.queue:
                    self.queue.append(mlist[item])
            if len(self.queue) > 0:
                self.history[c.path] = c.history[0][0]
                return self.queue
        except KeyError:
            return None
    def runQueue(self):
        if self.queue != [] and self.callback:
            messages = self.queue
            self.queue = []
            self.send(sorted(messages, key=lambda id: id))
    def loadChannel(self,channel):
        messages = self.getUpdate(channel)
        self.runQueue()
    def reset(self):
        try:
            if self.callback:
                self.send(False)
#                self.callback(False)
        except AttributeError:
            pass
        self.callback = None
        self.history = {}
        self.channels = []
        self.queue = []
    def toDict(self,public=True):
        cb = 1 if self.callback else 0
        if public:
            return {'pid':self.pid,'times':self.times,'channels':self.channels,'raw':self.raw}
        else:
            return {'pid':self.pid,'uid':self.uid,'history':self.history,'callback':cb,'times':self.times,'channels':self.channels,'raw':self.raw}
    def destroy(self):
        for chan in self.channels:
            c = PubSub.channels[chan]
            print '=======================================>'
            print c.subscribers
            print self.uid
            print '<======================================='
            c.subscribers.remove(self.uid)
            c.metaSubscribers.remove(self.uid)
            cl = c._getMetaUserList()
            if self.pid not in cl:
                c.sendMeta({'channel':c.path,'meta':{'users':cl}})

def debug(v):
    print v