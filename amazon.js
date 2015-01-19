/**
 * 
 * Extract kindle book list from the amazon web site
 * Code is written in phantomjs
 * 
 * Usage: phantomjs --ssl-protocol=any amazon.js e-mail password
 * 
 * Outputs two files:
 * 
 * 1. booklist.txt - a JSON stringified representation of the items
 * 2. booklist.csv - a CSV version of the relevant fields from the page
 * 
 * Note this code is quite fragile. It relies on an internal query from the 
 * 'Manage Devices ...' page the api only returns the first 1000 entries regardless
 * of the batch size used.
 * 
 * Because the API only returns 1000 entries, it reads the list 6 ways. Note if you
 * have over 2000 books you will not get a full listing - has been tested on a library
 * with 3500+ books. The book list is queried by decending then ascending date, then
 * title, then author. Duplicates are removed.
 * 
 * The Phantomjs browser needs to pretend to be an interactive browser 
 * (the userAgent string is from Chrome and may get out of date). If the user agent
 * is not faked then amazon does not generate the relevant cookies.
 * 
 * The Devices page can hang the browser. Need to use ssl-protocol flag on 
 * phantomjs as the default is not accepted by amazon at this time.
 * 
 * For diagnosis - A number of screen shots are created.
 * Calls the UK site - not sure if this works for non-UK owners.
 * 
 * @author Justin Saunders
 * 
 */

var page = require('webpage').create(),
    system = require('system'),
    fs = require('fs'),
    email, pass, loadInProgress = false, multiLoad = false, stepindex = 0, steps = [];

page.settings.userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/39.0.2171.65 Chrome/39.0.2171.65 Safari/537.36';
console.log('Using user agent of ' + page.settings.userAgent);

if (system.args.length !== 3) {
    console.log('Usage: amazon.js <user> <pass>');
    phantom.exit();
} else {
    email = system.args[1];
    pass = system.args[2];
    console.log("User: " + email);
}

/**
 * Simple heart beat for every page loaded.
 * 
 */

page.onLoadStarted = function() {
    loadInProgress = true;
    console.log("load started");
};

/**
 * Page loaded now.
 * 
 */

page.onLoadFinished = function() {
    loadInProgress = false;
    console.log("load finished");
};

/**
 * 
 * steps contains all of the pages to be visited.
 * A series of functions that make one page call or examine a page
 * unless multiload is true
 * 
 */

// Initial landing page - we will be redirected to login as part of this
// Yes this is the UK site

steps[0] = function() {
    // Initial page load
    console.log('RUNNING INITIAL PAGE');
    page.open('http://www.amazon.co.uk/gp/yourstore/home/ref=nav_cs_ys',
        function(status) {
        if(status !== 'success') {
            console.log('Failed to load the page: ' + status);
            phantom.exit();
        }
    });
};

// Login page - will be redirected here after going to the home page
// fill in the fields

steps[1] = function() {
    console.log('RUNNING LOGIN PAGE');
    console.log('Rendering page to amazon_login.png');
    page.render('amazon_login.png');
    page.evaluate(function(e, p) {
        document.getElementById('ap_email').value = e;
        document.getElementById('ap_password').value = p;
        document.getElementById('signInSubmit-input').click();
    }, email, pass);
};

//Home page - will be redirected here after entering the login details

steps[2] = function () {
    console.log('RUNNING HOME PAGE');
    console.log('Rendering page to amazon.png');
    page.render('amazon.png');
};

// Load the Manage Devices page which will initialise the cookies to call
// the web service. This visit sometimes hangs.

steps[3] = function() {
    // Load the devices page

    console.log('RUNNING DEVICES PAGE');

    page.open('https://www.amazon.co.uk/mn/dcw/myx.html/ref=kinw_myk_redirect#/home/content/booksAll/dateDsc/',
        function(status) {
        if(status !== 'success') {
            console.log('Failed to load the page: ' + status);
            phantom.exit();
        }
        console.log('Rendering page to amazon_devices.png');
        page.render('amazon_devices.png');
    });
};

// Make the calls to the book list web service - returns JSON

steps[4] = function() {
    // get the book list
    var bs = 50;
    var methods = [["DESCENDING", "DATE"], ["ASCENDING", "DATE"], 
                   ["DESCENDING", "TITLE"], ["ASCENDING", "TITLE"],
                   ["DESCENDING", "AUTHOR"], ["ASCENDING", "AUTHOR"]];
    console.log('GETTING THE BOOK LIST');
    getbookbatch('booklist', 0, bs, [], methods);
};

// Last step exit phantom

steps[5] = function() {
    phantom.exit();
};

/**
 * uniq - a function from stackoverflow uses orderDetailURL and the 
 * Amazon Stock Number as a unique identifier to dedup the book list when
 * multiple calls are made.
 * 
 */

function uniq(a) {
    var seen = {};
    return a.filter(function(item) {
        return seen.hasOwnProperty(item.orderDetailURL+item.asin) ? false : (seen[item.orderDetailURL+item.asin] = true);
    });
}

/**
 * writecsv - a function that will write out the relevant fields into a csv.
 * Takes the root of the filename and the book list array
 */

function writecsv(fn, items) {
	var out = '"Authors", "Title", "ASIN", "Order URL", "Product Image", "Acquired Date"\n';
	var val = [];
	var notfirst = false;
	for (it in items) {
		val = [];
		val[0] = items[it].authors;
		val[1] = items[it].title;
		val[2] = items[it].asin;
		val[3] = items[it].orderDetailURL;
		val[4] = items[it].productImage;
		val[5] = items[it].acquiredDate;
		notfirst = false;
		for(v in val) {
			val[v] = val[v].replace(/"/g, '""');
			if(notfirst) {
				out += ',';
			} else {
				notfirst = true;
			}
			out += '"' + val[v] + '"';
		}
		out += '\n';
	}
	fs.write(fn + '.csv', out, 'w');
}

/**
 * getbookbatch - The main routine to interact with the ajax-activity Amazon page.
 * To deal with the asynchronous nature of the return function, this calls itself
 * recursively to process the list in various orders and in suitable size batches
 * 
 * Arguments are:
 * 
 * The file name root,
 * The offset of the batch - initial call should be 0, 
 * the batch size something sensible - up to 100 seems to work
 * steps an embedded array of sort orders
 * 
 * The routine will recurse until the the ajax call returns no more items and the
 * array of sort orders has been traversed. The list of items is deduped.
 * 
 * Once the recursion is complete, the contents of the JSON is written to a txt
 * file and to the csv file.
 * 
 */

function getbookbatch(fn, start, bsize, books, steps) {
    var jss, js;
    var order = steps[0][0];
    var ind = steps[0][1];
    var settings = 
        "data=" + encodeURIComponent(JSON.stringify({
"param":{"OwnershipData":{"sortOrder": order,"sortIndex": ind,"startIndex": start, "batchSize":bsize,"contentType":"Ebook","itemStatus":["Active","Expired"],"excludeExpiredItemsFor":["KOLL","Purchase","Pottermore","FreeTrial","DeviceRegistration","ku","Sample"],"originType":["Purchase","PublicLibraryLending","PersonalLending","KOLL","RFFLending","Pottermore","Rental","DeviceRegistration","FreeTrial","ku","Sample"],"isExtendedMYK":true}}}
        ));

    console.log("Fetching book list in " + order.toLowerCase() + 
    		" " + ind.toLowerCase() + " order with batch start of " + start);
    page.customHeaders = {
        "Accept" : "application/json, text/plain, */*" };

    multiLoad = true;
    page.open('https://www.amazon.co.uk/mn/dcw/myx/ajax-activity', 'POST',
        settings, function(status) {
        if(status !== 'success') {
            console.log('Failed to load the web service: ' + status);
            phantom.exit();
        }

        jss = page.evaluate(function() {
            return document.body.innerHTML;
        });

        js = JSON.parse(jss);

        if((typeof(js.OwnershipData.success) !== 'undefined')&&
        		(js.OwnershipData.success === true)) {
            books.push.apply(books, js.OwnershipData.items);
            if(js.OwnershipData.hasMoreItems) {
                getbookbatch(fn, start + bsize, bsize, books, steps);
            }
            else
            {
            	steps.shift();
            	if(steps.length > 0) {
            		books = uniq(books);
                    getbookbatch(fn, 0, bsize, books, steps);
            	}
            	else
            	{
            		books = uniq(books);
                    fs.write(fn + ".txt", JSON.stringify(books), 'w');
                    writecsv(fn, books);
                    console.log("Got book list successfully - look in " + fn + ".csv");
                    
                    multiLoad = false;
            	}
            }
        } else {
        	console.log("Failed to get list of books from the web service");
        	phantom.exit();
        }
        
    });
}

/**
 * steprunner - the main loop that runs the functions in the steps array
 * moves on when the page is loaded and multiload is not set.
 */

function steprunner() {
    if((!loadInProgress) && (!multiLoad)) {
        steps[stepindex]();
        stepindex++;
    }
}

/**
 * runit - sets up steprunner to be called every 2 seconds
 */

function runit() {
    setInterval(steprunner, 2000);
}

runit();