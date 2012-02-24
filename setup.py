import distutils.core
kwargs = {}

version = "0.1"
extensions = []

distutils.core.setup(
    name="pubsub",
    version=version,
    packages = ["pubsub"],
    ext_modules = extensions,
    author="Tendrid",
    author_email="tendrid@gmail.com",
    url="http://www.peoplebacon.com/",
    license="http://www.apache.org/licenses/LICENSE-2.0",
    description="The Tornado PubSub project is a simple add-on to Tornado which implements a Publish / Subscribe server in python.",
    **kwargs
)