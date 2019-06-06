'use strict';
const createRouter = require('@arangodb/foxx/router');
const db = require('@arangodb').db;
const aql = require('@arangodb').aql;
const joi = require('joi');
const router = createRouter();

module.context.use(router);
module.context.use(function (req, res, next) {
    if(!req.arangoUser) {
        res.throw(401, 'Not authenticated');
    }
    next();
});

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

    let likedComments = (for c in comments 
        let countLikes = (c.c.snippet.topLevelComment.snippet.likeCount > 0 ? 1 : 0)
        collect aggregate mcount = SUM(countLikes)
        RETURN {"count": mcount})
    
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
    
    return {"publishedAt": publishedAt, "nbComments": length(comments), "likedComments": likedComments[0].count, "languageDistribution": langDistrib, "sentimentDistribution": sentimentDistrib}
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
    let allValues = JSON.parse(req.pathParams.value);
    let idArray = allValues.idArray;
    let startDate = "2000-01-29T15:48:52.000Z";
    let endDate = "3000-12-29T15:48:52.000Z";
    let nbComments = 25;
    let order = '';

    if (allValues.startDate) startDate = allValues.startDate;
    if (allValues.endDate) endDate = allValues.endDate;
    if (allValues.nbComments) nbComments = allValues.nbComments;
    if (allValues.order) {
        switch(allValues.order){
            case 'repliesAsc':
                order = 'sort c.snippet.totalReplyCount asc'; break;
            case 'repliesDesc':
                order = 'sort c.snippet.totalReplyCount desc'; break;
            case 'likesAsc':
                order = 'sort c.snippet.topLevelComment.snippet.likeCount asc'; break;
            case 'likesDesc':
                order = 'sort c.snippet.topLevelComment.snippet.likeCount desc'; break;
            case 'dateAsc':
                order = 'sort date asc'; break;
            case 'dateDesc':
                order = 'sort date desc'; break;
            default:
                order = '';
        }
    }

    let query = `
    /* Parameter examples:
    ["eROJBYpkUMg","twqM56f_cVo"]
    2017-06-29T15:48:52.000Z
    2018-07-29T15:48:52.000Z
    5
    */
    let comments = ( for c in Comments
        filter c.snippet.videoId IN ` + idArray + `
        let date = DATE_FORMAT(c.snippet.topLevelComment.snippet.publishedAt, "%yyyy-%mm-%dd")
        let sent = c.analysis.sentiment
        filter c.snippet.topLevelComment.snippet.publishedAt > DATE_ISO8601("` + startDate + `") AND c.snippet.topLevelComment.snippet.publishedAt < DATE_ISO8601("` + endDate + `")
        ` + order + `
        limit  ` + nbComments + `
        
        let version = first(flatten(for v in VideoMetadata filter v._key == c.snippet.videoId return v))
        let song = first(flatten(for r in Request filter r._id == version.request_id
                    return (for s in Song filter s._key == r.songId return s)))
        let reply = flatten((for r in inbound c repliedTo return r))
        
        return {
            "commentID": c._key,
            "versionID": c.snippet.videoId,
            "interpret": song.artist,
            "songName": song.title,
            "sentiment": sent,
            "commentText": c.snippet.topLevelComment.snippet.textOriginal,
            "commentAuthor": c.snippet.topLevelComment.snippet.authorDisplayName,
            "replies": reply,
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
var NLTKwords_en = ['#', '@', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you','re', 've', 'll', 'd', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 's', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don',  'should',  'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren',  'couldn', 'didn', 'doesn', 'hadn', 'hasn',  'haven', 'isn', 'ma', 'mightn', 'mustn', 'needn', 't', 'shan', 'shouldn', 'wasn', 'weren', 'won', 'wouldn']; 
var stopwords_de = ['#', '@', 'a', 'ab', 'aber', 'ach', 'acht', 'achte', 'achten', 'achter', 'achtes', 'ag', 'alle', 'allein', 'allem', 'allen', 'aller', 'allerdings', 'alles', 'allgemeinen', 'als', 'also', 'am', 'an', 'ander', 'andere', 'anderem', 'anderen', 'anderer', 'anderes', 'anderm', 'andern', 'anderr', 'anders', 'au', 'auch', 'auf', 'aus', 'ausser', 'ausserdem', 'außer', 'außerdem', 'b', 'bald', 'bei', 'beide', 'beiden', 'beim', 'beispiel', 'bekannt', 'bereits', 'besonders', 'besser', 'besten', 'bin', 'bis', 'bisher', 'bist', 'c', 'd', 'd.h', 'da', 'dabei', 'dadurch', 'dafür', 'dagegen', 'daher', 'dahin', 'dahinter', 'damals', 'damit', 'danach', 'daneben', 'dank', 'dann', 'daran', 'darauf', 'daraus', 'darf', 'darfst', 'darin', 'darum', 'darunter', 'darüber', 'das', 'dasein', 'daselbst', 'dass', 'dasselbe', 'davon', 'davor', 'dazu', 'dazwischen', 'daß', 'dein', 'deine', 'deinem', 'deinen', 'deiner', 'deines', 'dem', 'dementsprechend', 'demgegenüber', 'demgemäss', 'demgemäß', 'demselben', 'demzufolge', 'den', 'denen', 'denn', 'denselben', 'der', 'deren', 'derer', 'derjenige', 'derjenigen', 'dermassen', 'dermaßen', 'derselbe', 'derselben', 'des', 'deshalb', 'desselben', 'dessen', 'deswegen', 'dich', 'die', 'diejenige', 'diejenigen', 'dies', 'diese', 'dieselbe', 'dieselben', 'diesem', 'diesen', 'dieser', 'dieses', 'dir', 'doch', 'dort', 'drei', 'drin', 'dritte', 'dritten', 'dritter', 'drittes', 'du', 'durch', 'durchaus', 'durfte', 'durften', 'dürfen', 'dürft', 'e', 'eben', 'ebenso', 'ehrlich', 'ei', 'ei, ', 'eigen', 'eigene', 'eigenen', 'eigener', 'eigenes', 'ein', 'einander', 'eine', 'einem', 'einen', 'einer', 'eines', 'einig', 'einige', 'einigem', 'einigen', 'einiger', 'einiges', 'einmal', 'eins', 'elf', 'en', 'ende', 'endlich', 'entweder', 'er', 'ernst', 'erst', 'erste', 'ersten', 'erster', 'erstes', 'es', 'etwa', 'etwas', 'euch', 'euer', 'eure', 'eurem', 'euren', 'eurer', 'eures', 'f', 'folgende', 'früher', 'fünf', 'fünfte', 'fünften', 'fünfter', 'fünftes', 'für', 'g', 'gab', 'ganz', 'ganze', 'ganzen', 'ganzer', 'ganzes', 'gar', 'gedurft', 'gegen', 'gegenüber', 'gehabt', 'gehen', 'geht', 'gekannt', 'gekonnt', 'gemacht', 'gemocht', 'gemusst', 'genug', 'gerade', 'gern', 'gesagt', 'geschweige', 'gewesen', 'gewollt', 'geworden', 'gibt', 'ging', 'gleich', 'gott', 'gross', 'grosse', 'grossen', 'grosser', 'grosses', 'groß', 'große', 'großen', 'großer', 'großes', 'gut', 'gute', 'guter', 'gutes', 'h', 'hab', 'habe', 'haben', 'habt', 'hast', 'hat', 'hatte', 'hatten', 'hattest', 'hattet', 'heisst', 'her', 'heute', 'hier', 'hin', 'hinter', 'hoch', 'hätte', 'hätten', 'i', 'ich', 'ihm', 'ihn', 'ihnen', 'ihr', 'ihre', 'ihrem', 'ihren', 'ihrer', 'ihres', 'im', 'immer', 'in', 'indem', 'infolgedessen', 'ins', 'irgend', 'ist', 'j', 'ja', 'jahr', 'jahre', 'jahren', 'je', 'jede', 'jedem', 'jeden', 'jeder', 'jedermann', 'jedermanns', 'jedes', 'jedoch', 'jemand', 'jemandem', 'jemanden', 'jene', 'jenem', 'jenen', 'jener', 'jenes', 'jetzt', 'k', 'kam', 'kann', 'kannst', 'kaum', 'kein', 'keine', 'keinem', 'keinen', 'keiner', 'keines', 'kleine', 'kleinen', 'kleiner', 'kleines', 'kommen', 'kommt', 'konnte', 'konnten', 'kurz', 'können', 'könnt', 'könnte', 'l', 'lang', 'lange', 'leicht', 'leide', 'lieber', 'los', 'm', 'machen', 'macht', 'machte', 'mag', 'magst', 'mahn', 'mal', 'man', 'manche', 'manchem', 'manchen', 'mancher', 'manches', 'mann', 'mehr', 'mein', 'meine', 'meinem', 'meinen', 'meiner', 'meines', 'mensch', 'menschen', 'mich', 'mir', 'mit', 'mittel', 'mochte', 'mochten', 'morgen', 'muss', 'musst', 'musste', 'mussten', 'muß', 'mußt', 'möchte', 'mögen', 'möglich', 'mögt', 'müssen', 'müsst', 'müßt', 'n', 'na', 'nach', 'nachdem', 'nahm', 'natürlich', 'neben', 'nein', 'neue', 'neuen', 'neun', 'neunte', 'neunten', 'neunter', 'neuntes', 'nicht', 'nichts', 'nie', 'niemand', 'niemandem', 'niemanden', 'noch', 'nun', 'nur', 'o', 'ob', 'oben', 'oder', 'offen', 'oft', 'ohne', 'ordnung', 'p', 'q', 'r', 'recht', 'rechte', 'rechten', 'rechter', 'rechtes', 'richtig', 'rund', 's', 'sa', 'sache', 'sagt', 'sagte', 'sah', 'satt', 'schlecht', 'schluss', 'schon', 'sechs', 'sechste', 'sechsten', 'sechster', 'sechstes', 'sehr', 'sei', 'seid', 'seien', 'sein', 'seine', 'seinem', 'seinen', 'seiner', 'seines', 'seit', 'seitdem', 'selbst', 'sich', 'sie', 'sieben', 'siebente', 'siebenten', 'siebenter', 'siebentes', 'sind', 'so', 'solang', 'solche', 'solchem', 'solchen', 'solcher', 'solches', 'soll', 'sollen', 'sollst', 'sollt', 'sollte', 'sollten', 'sondern', 'sonst', 'soweit', 'sowie', 'später', 'startseite', 'statt', 'steht', 'suche', 't', 'tag', 'tage', 'tagen', 'tat', 'teil', 'tel', 'tritt', 'trotzdem', 'tun', 'u', 'uhr', 'um', 'und', 'und?', 'uns', 'unse', 'unsem', 'unsen', 'unser', 'unsere', 'unserer', 'unses', 'unter', 'v', 'vergangenen', 'viel', 'viele', 'vielem', 'vielen', 'vielleicht', 'vier', 'vierte', 'vierten', 'vierter', 'viertes', 'vom', 'von', 'vor', 'w', 'wahr?', 'wann', 'war', 'waren', 'warst', 'wart', 'warum', 'was', 'weg', 'wegen', 'weil', 'weit', 'weiter', 'weitere', 'weiteren', 'weiteres', 'welche', 'welchem', 'welchen', 'welcher', 'welches', 'wem', 'wen', 'wenig', 'wenige', 'weniger', 'weniges', 'wenigstens', 'wenn', 'wer', 'werde', 'werden', 'werdet', 'weshalb', 'wessen', 'wie', 'wieder', 'wieso', 'will', 'willst', 'wir', 'wird', 'wirklich', 'wirst', 'wissen', 'wo', 'woher', 'wohin', 'wohl', 'wollen', 'wollt', 'wollte', 'wollten', 'worden', 'wurde', 'wurden', 'während', 'währenddem', 'währenddessen', 'wäre', 'würde', 'würden', 'x', 'y', 'z', 'z.b', 'zehn', 'zehnte', 'zehnten', 'zehnter', 'zehntes', 'zeit', 'zu', 'zuerst', 'zugleich', 'zum', 'zunächst', 'zur', 'zurück', 'zusammen', 'zwanzig', 'zwar', 'zwei', 'zweite', 'zweiten', 'zweiter', 'zweites', 'zwischen', 'zwölf', 'über', 'überhaupt', 'übrigens'];
let data = [];
let commentsAll = 0;
let commentsUsed = 0;
let dataCloud = [];
let listSongs = [];
let wordCounted = [];

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
    keys = db._query(query).toArray();
    keys.forEach((res) => { data = data.concat(res.comment) });
    createWordCloud();
    keys = {'commentsAll': commentsAll, 'commentsUsed': commentsUsed, 'dataCloud': dataCloud, 'listSongs': listSongs, 'wordCounted': wordCounted};
    res.send(keys);
    data = []; dataCloud = []; listSongs = []; wordCounted = []; commentsAll = 0; commentsUsed = 0;
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
		    if (array[i].trim().toLowerCase() === stopWord.trim().toLowerCase() || array[i].length <= 2) {
		        array.splice(i, 1);
		    }
		}
	});	
	return array;
}
