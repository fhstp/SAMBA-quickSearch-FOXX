'use strict';
const createRouter = require('@arangodb/foxx/router');
const db = require('@arangodb').db;
const aql = require('@arangodb').aql;
const joi = require('joi');
const router = createRouter();

module.context.use(router);
/*module.context.use(function (req, res, next) {
    if(!req.arangoUser) {
        res.throw(401, 'Not authenticated');
    }
    next();
});
*/
// https://www.arangodb.com/docs/stable/foxx-guides-browser.html
// in your main entry file, e.g. index.js
module.context.trustProxy = true;

//value example : "bilderbuch"
function filterQuery(value) {
    // Keeps only videos that have comments, and whose title matches the request
    let base = `
	filter version.statistics.nbCommentInDb > 0`;
    // contains(upper(videos[*].version.snippet.title), upper(${value}));
    let splitted = value.split(/[ .\-_)(]/);
    for (let i = 0; i < splitted.length; i++) {
		base += ` and contains(upper(version.snippet.title), upper("` + splitted[i] + `"))`;
    }
    return base;
}

router.get('/quickSearch/:value', function (req, res) {
    let search = req.pathParams.value;
    let filter = filterQuery(search);
    let query = `
    for version in VideoMetadata
    ` + filter + `
    sort version.statistics.nbCommentInDb desc, to_number(version.statistics.likeCount) desc
    let song = first(flatten(for r in Request filter r._id == version.request_id
        return (for s in 1 outbound r requestedAbout
            return s)
            ))
    collect s = song into videos
    sort first(videos).version.statistics.nbCommentInDb desc

    return {"artist" : s.artist, "title": s.title, "versions" : videos[*].version/*.statistics.nbCommentInDb*/}
    `;
    let keys;
    keys = db._query(query);
  res.send(keys);

})//.body(joi.object().required(), 'Search String')
.response(joi.object().required(), 'Search video titles matching the request')
.summary('Search videos')
.description('Returns videos whose title contains the requested words. Nested by song, ordered by comment count descending.');

router.get('/songDetails/:value', function (req, res) {
    let idArray = req.pathParams.value;
    //let filter = filterQuery(search);
    let query = `
    //idArray example : ["eROJBYpkUMg"]
    for version in VideoMetadata
    Filter version._key IN ` + idArray + `
    
    let song = first(flatten(for r in Request filter r._id == version.request_id
        return (for s in 1 outbound r requestedAbout
            return s)
            ))
            
    let comment = flatten(//for c in inbound version commentOnVideo //Seems to be slower than the direct access
        for c in Comments filter c.snippet.videoId == version._key
                            /* To uncomment when changing the data structure
                            let replies = (for r in inbound c repliedTo
                                            return r)
                            return merge(c, {"replies":replies})*/
                            return c)
        
    let reply = flatten(for c in comment
        //for r in Reply filter r.snippet.parentId == c._key //Does not seem to be faster than the traversal
        return (for r in inbound c repliedTo
            return r))
        
    let artist = first(flatten(return (for a in 1 inbound song sang return a)))

    let stats = (for stat in 1 inbound version statisticsFrom return stat)

    return {"artist" : [artist],
        "song" : song, 
        "data" : [version], 
        "comment" : comment,
        "reply": reply,
        "hardfacts": stats}
    `;
    let keys;
    keys = db._query(query);
  res.send(keys);

})//.body(joi.object().required(), 'Search String')
.response(joi.object().required(), 'Search video details for a given array of video ids')
.summary('Search videos details for idArray')
.description('Returns details (including comments) for the requested video ids.');


router.get('/songDetailsNoText/:value', function (req, res) {
    let idArray = req.pathParams.value;
    //let filter = filterQuery(search);
    let query = `
    //idArray example : ["eROJBYpkUMg"]
    for version in VideoMetadata
    Filter version._key IN ` + idArray + `
    
    let song = first(flatten(for r in Request filter r._id == version.request_id
        return (for s in 1 outbound r requestedAbout
            return s)
            ))
            
    let comment = flatten(//for c in inbound version commentOnVideo //Seems to be slower than the direct access
        for c in Comments filter c.snippet.videoId == version._key
                            /* To uncomment when changing the data structure
                            let replies = (for r in inbound c repliedTo
                                            return r)
                            return merge(c, {"replies":replies})*/
                            return merge_recursive (c, { "snippet": { "topLevelComment" : {"snippet": {"textDisplay": "", "textOriginal": ""}}}}))
                            //return UNSET (c, "snippet")) // UNSET (c, ["snippet.topLevelComment.snippet.textDisplay", "snippet.topLevelComment.snippet.textOriginal"]))
        
    let reply = flatten(for c in comment
        //for r in Reply filter r.snippet.parentId == c._key //Does not seem to be faster than the traversal
        return (for r in inbound c repliedTo
            return r))
        
    let artist = first(flatten(return (for a in 1 inbound song sang return a)))

    let stats = (for stat in 1 inbound version statisticsFrom return stat)

    return {"artist" : [artist],
        "song" : song, 
        "data" : [version], 
        "comment" : comment,
        "reply": reply,
        "hardfacts": stats}
    `;
    let keys;
    keys = db._query(query);
  res.send(keys);

})//.body(joi.object().required(), 'Search String')
.response(joi.object().required(), 'Search video details for a given array of video ids')
.summary('Search videos details for idArray')
.description('Returns details (EXCLUDING comment texts) for the requested video ids.');


router.get('/songAggregations/:value', function (req, res) {
    let idArray = req.pathParams.value;
    //let filter = filterQuery(search);
    let query = `
//key example : ["twqM56f_cVo"] (Parov Stelar) or ["eROJBYpkUMg"]
let NA = 42
let MIXED_SENT = 666
let agg = (

for c in Comments
    filter c.snippet.videoId IN ` + idArray + `
    let date = DATE_FORMAT(c.snippet.topLevelComment.snippet.publishedAt, "%yyyy-%mm-%dd")
    collect publishedAt = date into comments
    
    let langDistrib = (for c in comments 
        collect language = c.c.analysis.mainLanguage with count into nbComments 
        return {"language": language, "nbComments": nbComments})
    
    
    let sentimentDistrib = (for c in comments

        let mixed = (
            for tool in [c.c.analysis.sentiment.nltk.compound, c.c.analysis.sentiment.textBlob.polarity, c.c.analysis.sentiment.afinn.normalized]
            collect
            AGGREGATE 
                posCount = SUM(tool > 0 ? 1 : 0),
                negCount = SUM(tool < 0 ? 1 : 0)
                
            return {"mixed":(posCount > 0 and negCount > 0 ? true : false)/*, "posCount": posCount, "negCount":negCount*/})
            
        let sentiment = (!c.c.analysis.sentiment ? NA : ( mixed.mixed ? MIXED_SENT :
            AVERAGE([c.c.analysis.sentiment.nltk.compound, c.c.analysis.sentiment.textBlob.polarity, c.c.analysis.sentiment.afinn.normalized])))
        
        collect
        AGGREGATE 
            numberOfNAs = SUM(sentiment == NA ? 1 : 0),
            numberOfMixed = SUM(sentiment == MIXED_SENT ? 1 : 0),
            numberOfPositiveComments = SUM(sentiment > 0 AND sentiment <= 1  ? 1 : 0),
            numberOfNegativeComments = SUM(sentiment < 0 ? 1 : 0),
            numberOfNeutral = SUM(sentiment == 0 ? 1 : 0)
            
        return {"positive": numberOfPositiveComments, "negative": numberOfNegativeComments, "neutral": numberOfNeutral, "NAs": numberOfNAs, "mixed": numberOfMixed})
    
    return {"publishedAt": publishedAt, "nbComments": length(comments), "languageDistribution": langDistrib, "sentimentDistribution": sentimentDistrib}
    )

return {"videoIds": ` + idArray + `, "aggregations": agg}
//insert {"videoId": ` + idArray + `, "aggregations": agg} in Aggregation return NEW
//insert link between video and aggregation ?
    `;
    let keys;
    keys = db._query(query);
  res.send(keys);

})
.response(joi.object().required(), 'Returns video aggregations for a given array of video ids')
.summary('Returns video aggregations for idArray')
.description('Returns daily aggregations (nb comments, language distribution, ...) for the requested video ids.');

router.get('/songStatistics/:value', function (req, res) {
    let idArray = req.pathParams.value;
    //let filter = filterQuery(search);
    let query = `
    //key example : ["twqM56f_cVo"] (Parov Stelar) or ["eROJBYpkUMg"]
    let stats = (
        let deduplicatedList = (
        for stat in VideoStatistics
            filter stat.videoId IN ` + idArray + `
            let date = DATE_FORMAT(stat.retrievalTime, "%yyyy-%mm-%dd")
            collect retrievedAt = date, videoId = stat.videoId
            into groups
            return groups[0]
        )
        for stats in deduplicatedList
            collect retrievalDate = stats.date
            aggregate
                likeCount = SUM(TO_NUMBER(stats.stat.likeCount)),
                dislikeCount = SUM(TO_NUMBER(stats.stat.dislikeCount)),
                commentCount = SUM(TO_NUMBER(stats.stat.commentCount)),
                viewCount = SUM(TO_NUMBER(stats.stat.viewCount))
    
            return {retrievalDate, likeCount, dislikeCount, commentCount, viewCount}
    )
    
    return {"videoIds": ` + idArray + `, "videoStatistics": stats}
    //insert {"videoId": @key, "aggregations": agg} in Aggregation return NEW
    //insert link between video and aggregation ?
    `;
    let keys;
    keys = db._query(query);
  res.send(keys);

})
.response(joi.object().required(), 'Returns video statistics for a given array of video ids')
.summary('Returns video statistics for idArray')
.description('Returns daily statistics (view count, like count, dislike count, comment count) for the requested video ids.');


router.get('/comments/:value', function (req, res) {
    let idArray = req.pathParams.value;
    let startDate = `"2017-06-29T15:48:52.000Z"`;
    let endDate = `"2018-06-29T15:48:52.000Z"`;
    let nbComments = 5;
    
    let query = `
    /* Parameter examples:
    ["eROJBYpkUMg","twqM56f_cVo"]
    2017-06-29T15:48:52.000Z
    2018-07-29T15:48:52.000Z
    5
    */
    let comments = ( for c in Comments
        filter c.snippet.videoId IN  ` + idArray + `
        //let date = DATE_FORMAT(c.snippet.topLevelComment.snippet.publishedAt, "%yyyy-%mm-%dd")
        filter c.snippet.topLevelComment.snippet.publishedAt > DATE_ISO8601(` + startDate + `) AND c.snippet.topLevelComment.snippet.publishedAt < DATE_ISO8601(` + endDate + `)
        sort c.snippet.totalReplyCount desc, c.snippet.topLevelComment.snippet.likeCount//, to_number(version.statistics.likeCount) desc
        limit  ` + nbComments + `
        
        let version = first(flatten(for v in VideoMetadata filter v._key == c.snippet.videoId return v))
        let song = first(flatten(for r in Request filter r._id == version.request_id
                    return (for s in Song filter s._key == r.songId return s)))//return (for s in 1 outbound r requestedAbout return s))
        /*
    let reply = flatten(for c in comments
        //for r in Reply filter r.snippet.parentId == c._key //Does not seem to be faster than the traversal
        return (for r in inbound c repliedTo
            return r))
*/
        
        return {
            "commentID": c._key,
            "versionID": c.snippet.videoId,
            "interpret": song.artist,
            "songName": song.title,
            "sentiment": [
                // in there the 3 different analysis objects
            ],
            "commentText": c.snippet.topLevelComment.snippet.textOriginal,
            "commentAuthor": c.snippet.topLevelComment.snippet.authorDisplayName,
            "replies": [
                // here goes an array of all replies to this comment
                ],
            "likes": c.snippet.topLevelComment.snippet.likeCount,
            "dateTime": c.snippet.topLevelComment.snippet.publishedAt
        })

    return {
        videoIds: ` + idArray + `,
        comments:comments
    }`;
    let comments;
    comments = db._query(query);
    // comments = db.query({
    //     query: query,
    //     bindVars: { key: idArray, startDate:startDate, endDate:endDate, nbComments:nbComments }
    //   });
    res.send(comments);

})
.response(joi.object().required(), 'Returns comments for a given array of video ids, filters and sort order')
.summary('Returns comments for idArray')
.description('Retunrs comments for the requested video ids, filters and sort order.');

// TOPIC ///////////////////////////////////////////////////////////////////////////////////////////////////////// */
var data = [];
var commentsAll = 0;
var commentsUsed = 0;
var dataCloud = [];
var listSongs = [];
var wordCounted = [];

router.get('/songTopics/:value', function (req, res) {
    let idArray = req.pathParams.value;
    let query = `
    for version in VideoMetadata
    Filter version._key IN ` + idArray + `

    let song = first(flatten(
        for r in Request filter r._id == version.request_id
        return (
            for s in 1 outbound r requestedAbout
            return s
        )
    ))
            
    let comment = flatten(
        for c in Comments filter c.snippet.videoId == version._key
        return {"analysis": c.analysis, "song" : song.title, "text" : c.snippet.topLevelComment.snippet.textOriginal}
    )
        
    return {comment}
    `;
    let keys;
    keys = db._query(query);
    data = keys[0].comment;
    createWordCloud();
    keys = {'commentsAll': commentsAll, 'commentsUsed': commentsUsed, 'dataCloud': dataCloud, 'listSongs': listSongs, 'wordCounted': wordCounted};
    res.send(keys);
})
.response(joi.object().required(), 'Returns topic analysis for a given array of video ids')
.summary('Returns topic analysis for idArray')
.description('Returns data from topic analysis (dataCloud, wordCounted, etc.) for the requested video ids.');

/* TOPIC AUXILIARY FUNCTIONS ///////////////////////////////////////////////////////////////////////////////////// */

function createWordCloud() {
	var words = [];
	// Tokenize and clean each [english/german] comment
	data.forEach((d) => {
		commentsAll++;
	  if (d.analysis && (d.analysis.mainLanguage === 'en' || d.analysis.mainLanguage === 'de')) {
	  	commentsUsed++;
	    var topicSent = getSentiment(d);	// get sentiments from comment

	    // tokenize comment string
	    let word_tokens = d.text.split(/[^a-zA-Z0-9_#@\u00dc\u00fc\u00c4\u00e4\u00d6\u00f6\u00df]+/);
	    while (word_tokens.indexOf('') !== -1) { word_tokens.splice( word_tokens.indexOf(''), 1); }

	    // Remove stopwords according to language
		if (d.analysis.mainLanguage === 'en') {
			word_tokens = removeStopwords(word_tokens, NLTKwords_en);
		} else if (d.analysis.mainLanguage === 'de') {
			word_tokens = removeStopwords(word_tokens, stopwords_de);
		}
	    
	    word_tokens.forEach((word) => {
	      words.push({ topic: word, sentiment: topicSent, song: d.song });
	    });

	    if (listSongs.indexOf(d.song.toString()) === -1) {
	      listSongs.push(d.song.toString());
	    }
	  }
	});

	counter(words);
}

function getSentiment(d) {
	if (d.analysis.sentiment) {
	  const thisnltk = d.analysis.sentiment.nltk.compound;
	  const thisblob = d.analysis.sentiment.textBlob.polarity;
	  const thisafinn = d.analysis.sentiment.afinn.normalized;

	  if (isIconsistent([thisnltk, thisblob, thisafinn])) {
	    return 0;
	  } else {
	    const sentPolarity = ((thisnltk + thisafinn + thisblob) / 3);
	    if (sentPolarity > 0) {
	      return 1;
	    } else if (sentPolarity === 0) {
	      return 0;
	    } else if (sentPolarity < 0) {
	      return -1;
	    }
	  }
	} else { return 0; }
}

function isIconsistent (sentValues) {
	let countPos = 0;
	let countNeg = 0;

	sentValues.forEach((value) => {
	  if (value > 0) { countPos++; } else if (value < 0) { countNeg++; }
	});

	if (countPos > 0 && countNeg > 0) { return true; } else { return false; }
}

// Receive a list with words and the sentiment and song name from the comment the wors came from
function counter(words) {
	var cWds = [];

	words.forEach((w) => {
	  var inList = false;
	  var idxcw = 0;
	  // searches the position of the element if it is in the list
	  cWds.forEach((cw) => {
	    if (inList === false) {
	      if (cw.text.trim().toLowerCase() === w.topic.trim().toLowerCase()) { inList = true; } else { idxcw++; }
	    }
	  });

	  if (inList) {
	    cWds[idxcw].count++;
	    cWds[idxcw].sentiment += w.sentiment;
	    if (cWds[idxcw].songs.indexOf(w.song.toString()) === -1) {
	      cWds[idxcw].songs.push(w.song.toString());
	    }
	  } else {
	    cWds.push({ text: w.topic.toString(), count: 1, sentiment: w.sentiment, songs: [w.song.toString()] });
	  }
	});

	var dataForCloud = [];
	if (cWds.length > 0) {
	  cWds.sort(function(a, b) { return b.count - a.count; });
	  wordCounted = cWds;

	  // Get 10 topics. If the list of counted words has less then 10 words we display only the existing topics
	  var size = 10;
	  var maxTopics = 10;
	  if (cWds.length < 10) { size = cWds.length; maxTopics = cWds.length; }
	  var i = 0;
	  while (i < maxTopics) {
	    var sentcolor = getColor(cWds[i].sentiment / cWds[i].count);
	    dataForCloud.push({ text: cWds[i].text.toString(), weight: size, color: sentcolor.toString()}); // tooltip: cWds[i].songs.join(', ')
	    i++;
	    size -= 1;
	  }
	}

	dataCloud = dataForCloud;
}

function getColor(sent) {
	if (sent > 0) { return '#4daf4a'; } else if (sent < 0) { return '#ff7f00'; }
	return '#cccccc';
}

function removeStopwords(array, stopWordList){
	stopWordList.forEach((stopWord) => {
        for (var i=array.length-1; i>=0; i--) {
		    if (array[i].trim().toLowerCase() === stopWord.trim().toLowerCase() || array[i].length === 1) {
		        array.splice(i, 1);
		    }
		}
	});	
	return array;
}
