from gates import *
from engine import PubSub, User
import time
import datetime
import tornado.escape

class Base(object):
    _psi = None
    _receive = None
    _receive_cmd = None
    _send = None
    _send_cmd = None

    def __init__(self):
        self.pubSubInstance

    @property
    def pubSubInstance(self):
        if self._psi == None:
            self._psi = PubSub()
            self._psi.start()
            print "WHY ARE WE HERE? -------------------------------------------------------------------------------------------"
            self._psi.preLoadData(1)
            self._psi.preLoadData(2)
        return self._psi

    @property
    def receive(self):
        if self._receive == None:
            self._receive = {'cmd':self.receiveCommand,'channel_item':self.receiveChannelItem,'channel':self.receiveChannel,'user':self.receiveUser}
        return self._receive
        
    def receiveCommand(self,data,user=None):
        if self._receive_cmd == None:
            self._receive_cmd = {'subscribe':self._r_sub, 'unsubscribe':self._r_sub, 'getChannelList':self._r_gcl, 'getUserInfo':self._r_gui}
        try:
            func = self._receive_cmd[data['cmd']]
            retVal = func(data,user)
        except KeyError:
            retVal = False
        return retVal
    
    def receiveChannelItem(self,data,user):
        user.times["lastPublished"] = int(time.mktime(datetime.datetime.now().timetuple()))
        out = self.pubSubInstance.createChannelItem(data["channel_item"],data["channels"],data["cid"])
        self.out(dict(ok='channel_item ok'))
            
    def receiveChannel(self,data,user):
        # STUBBED
        pass
    
    def receiveUser(self,data,user):
        # STUBBED
        pass
    
    def _r_sub(self,data,user):
        try:
            cmd = data['cmd']
            channels = data['channel'].split(',')
            for chan in channels:
                if cmd == 'subscribe':
                    user.subscribe(chan)
                else:
                    user.unsubscribe(chan)
            self.out(dict(ok="{0} ok".format(cmd)))
        except KeyError:
            self.out(dict(error='invalid channel'))

    def _r_gcl(self,data,user):
        channelJson = []
        for channel in self.pubSubInstance.channels.values():
            channelJson.append(channel.toDict())
        self.out(dict(channels=channelJson))

    def _r_gui(self,data,user):
        try:
            user = self.pubSubInstance.users[data['session_id']]
            self.out(dict(user=user.toDict()))
        except KeyError:
            self.out(dict(error='invalid user'))

    """
    send
    """
    def send_cmd(self):
        pass
    
    def send_user(self):    
        pass
    
    def send_channel_item(self):
        pass
    
    def send_channel(self):
        pass

    def get_user(self,session_id=None):
        if session_id == None:
            session_id = self.get_argument("session_id", None)
        if session_id == None:
            return False
        user_json = self.get_secure_cookie("user")
        if not user_json: return None
        u = tornado.escape.json_decode(user_json)
#        if not session_id:
#            session_id = u['sid']
        try:
            return self.pubSubInstance.users[session_id]
        except (TypeError, KeyError):
            try:
                if session_id:
                    self.pubSubInstance.users[session_id] = User(u,session_id)
                    return self.pubSubInstance.users[session_id]
                else:
                    return User(u)
            except KeyError:
                self.clear_cookie('user')
                pass
        return        
    