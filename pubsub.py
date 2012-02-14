import settings
import uuid
import tornado.web


class PubSub(object):
    channels = {}
    masterList = {}
    db = None
    chanSet = {}
    _gate = {}
    _collections = {}
    users = {}

    def connect(self,id):
        try:
            return self._collections[id]
        except:
            #todo: try to load collection from db, then fail
            return None

    class _conn(object):
        def __init__(self,raw):
            raw = raw[0]
            self.gate = pubSubInstance._gate[raw['gate']]
            self.loc = raw['loc']
            self.db = self.gate.db()
    
    def _buildGates(self):
        for comm in __import__("gates.__init__").__all__:
            self._gate[comm] = __import__("gates.{0}".format(comm),None,None,'*')
        coll = self._gate[settings.DEFAULT_STORAGE].db().getCollections()
        for collection in coll:
            self._collections[collection.id] = self._conn(coll)
        self.db = self._gate[settings.DEFAULT_STORAGE].db()

    def _buildCallbacks(self):
        # parent callback
        def func(cls,param):
            #todo: reference parent, adobt rules
            pass
        self.chanSet["parent"] = func
        
        # set channel history limit callback
        def func(cls,param):
            cls._setHistoryLimit(param)
        self.chanSet["historylimit"] = func

    """BETA"""
    def subscribe(self,channel,user):
        try:
            self.channels[channel].subscribe(user)
        except KeyError:
            return dict(error='invalid channel')
    
    """BETA"""
    def getChannel(self,channel,default):
        try:
            return self.channels[channel]
        except KeyError:
            return None
        
    """BETA"""
    def getList(self,user):
        for channel in user.channels:
            messages = []
            mlist = {}
            c = self.channels[channel]
            try:
                cursor = user.history[channel]
            except KeyError:
                cursor = None
            for item in c.history:
                if cursor == item[0]:
                    break
                try:
                    if not mlist[item[1]]:
                        mlist[item[1]] = c.library[item[1]]
                except KeyError:
                    mlist[item[1]] = c.library[item[1]]
            for item in mlist:
                messages.append(mlist[item])
            if len(messages) > 0:
                return messages
        return None
    
    """BETA"""
    def waitForEvent(self, callback, user):
        messages = self.getList(user)
        if not user.callback:
            user.callback = callback
        else:
            #todo: clean up.  not universal.
            self.finish(dict(error='Already logged in.',redirect='/reset/user'))

    """Loaders"""
    def preLoadData(self,collection_id,announce = False):
        try:
            col = self._collections[collection_id]
        except:
            #todo: handle this
            print "FAILED TO LOAD COLLECTION"
            return None
        items = col.db.getChannelItems(col.loc)
        for row in items:
            try:
                self.channels[row['channel']].updateItem(row, collection_id, announce)
            except KeyError:
                self.load_channels()
                self.channels[row['channel']].updateItem(row, collection_id, announce)

    """BETA"""
    def load_channels(self):
        rows = self.db.getChannels()
        for row in rows:
            if row['channel'] not in self.channels:
                print 'adding channel '+ row['channel']
                self.channels[row['channel']] = Channel(row)
        return self.channels

class Channel():

    def __init__(self, raw):
        self.subscribers = {}
        self.history = []
        self.library = {}
        self.historyLimit = None
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
            #print "error in params"
            return
        #load settings
        for param in params:
            if param in settings.CHANNEL_PARAMS:
                try:
                    pubSubInstance.chanSet[param](self, params[param])
                except KeyError:
                    print "Channel callback {0} not set.".format(param)

    def _setHistoryLimit(self,limit):
        self.historyLimit = limit
        self.cleanHistory()

    def cleanHistory(self):
        if self.historyLimit:
            #pop by oldest from self.history where self.limit > count
            #delete by id from self.library where id in popped data
            pass            

    def subscribe(self, user):
        self.subscribers[user.id()] = user
        user.getUpdate(self)
        user.runQueue()
        try:
            return self.history[0]
        except IndexError:
            return None
    def unsubscribe(self, user):
        del self.subscribers[user.id()]
        
    def publish(self, ChannelItem):
        self.library[ChannelItem.id] = ChannelItem
        self.addToHistory(ChannelItem)
        
        users = self.subscribers.values()
        for user in users:
            user.getUpdate(self.path)
        return users
    def addToHistory(self, ci):
        self.history.insert(0,[str(uuid.uuid4()), ci.id])
    def toDict(self):
        return {'id':self.id,'path':self.path,'name':self.name,'description':self.description}
    
    def updateItem(self,raw,collection_id,announce=True):
        if raw['id']:
            id = str(collection_id)+'_'+str(raw['id'])
            try:
                pubSubInstance.masterList[id].update(raw,announce)
            except KeyError:
                pubSubInstance.masterList[id] = ChannelItem(raw,announce)
            self.addToHistory(pubSubInstance.masterList[id])
            self.library[id] = pubSubInstance.masterList[id]


class ChannelItem():
    def __init__(self,raw,announce = False):
        self._id = raw['id']
        self.id = str(raw['collection_id'])+'_'+str(raw['id'])
        self.data = {}
        self.channels = []
        self.update(raw.copy(),announce)
        self.collection = pubSubInstance.connect(raw['collection_id'])

    def update(self,raw=None,pub=True):
        if not raw:
            raw = self.getFromDB()
        for k,v in raw.items():
            self.attr(k,v)
        if pub:
            self.publish()
    def publish(self):
        users = {}
        #loop through all channels
        for chan in self.channels:
            #get a list of users subscribed to channel
            for user in chan.publish(self):
                users[user.id] = user
        #loop through users, execute queues
        for user in users.values():
            user.runQueue()
                
    def getFromDB(self):
        rows = self.collection.db.getChannelItem(self._id)
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
            retVal['channels'].append(chan.path)
        return retVal
    def addChan(self,channel):
        cls = PubSub
        chan = cls.channels[channel]
        if chan not in self.channels:
            self.channels.append(chan)

class User():
    def __init__(self, raw):
        self.name = raw['name']
        self.history = {}
        self.callback = None
        self.channels = {}
        self.queue = []
    def id(self):
        return self.name
    def auth(self):
        #TODO: connect to db or whatever
        return true
    def subscribe(self,channel,announce=True):
        try:
            print self.name +' just subscribed to '+channel
            hist = pubSubInstance.channels[channel].subscribe(self)
            if hist:
                self.history[hist[1]] = hist[0]
            self.channels[channel] = pubSubInstance.channels[channel]
        except KeyError:
            #TODO: bubble up these errors
            return dict(error='invalid channel')
        if announce:
            self.loadChannel(channel)
    def unsubscribe(self,channel):
        try:
            print self.name +' just unsubscribed to '+channel
            cls = PubSub
            cls.channels[channel].unsubscribe(self)
        except KeyError:
            #TODO: bubble up these errors
            return dict(error='invalid channel')
    def getChannelCursor(self,channel):
        try:
            return self.history[channel]
        except KeyError:
            return None
    def getUpdate(self,channel):
        cursor = self.getChannelCursor(channel)
        try:
            mlist = {}
            c = pubSubInstance.channels[channel]
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
            callback = self.callback
            self.callback = None
            callback(messages)
    def loadChannel(self,channel):
        messages = self.getUpdate(channel)
        self.runQueue()
    def reset(self):
        #this can be done way better
        self.callback(False)
        self.callback = None
        self.history = {}
        self.channels = {}
        self.queue = []

#init
pubSubInstance = PubSub()
pubSubInstance._buildGates()
pubSubInstance._buildCallbacks()
pubSubInstance.load_channels()