#npm
install.cdk:
	npm install -g aws-cdk

install: install.cdk
	npm install
	cdk synth

#python
pip.install:
	cd app && pip3 install -t . -r ./requirements.txt