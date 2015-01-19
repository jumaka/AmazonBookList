# Amazon Book List

A phantomjs script to extract the list of kindle books from amazon.co.uk
 
## Usage:

    phantomjs --ssl-protocol=any amazon.js e-mail password

## Outputs

Two files:

1. booklist.txt - a JSON stringified representation of the items
2. booklist.csv - a CSV version of the relevant fields from the page

## Notes (here be dragons ...)

This code is quite fragile. It relies on an internal web service from the 
'Manage Devices ...' page the web service only returns the first 1000 entries
regardless
of the batch size used.

Because the API only returns 1000 entries, it reads the list 6 ways. Note if you
have over 2000 books you will not get a full listing - has been tested on a library
with 3500+ books. The book list is queried by decending then ascending date, then
title, then author. Duplicates are removed.

The Phantomjs browser needs to pretend to be an interactive browser 
(**the userAgent string is from Chrome and may get out of date**). If the user agent
is not faked then amazon does not generate the relevant cookies.

** The Devices page can hang the browser. **

Need to use ssl-protocol flag on 
phantomjs as the default is not accepted by amazon at this time.

** Calls the UK site - not sure if this works for non-UK owners. ** 

## Diagnostics

The program sticks copious output on the console and outputs a number of
screen shots to PNG

Happy hunting