#!/usr/bin/env bash
echo "installing Apache and setting it up..."
cp -r /vagrant/html/* /var/www/html/
service httpd restart
