(async function viewDocument(req, title) {
	const doc = processTitle(title);
	var { rev } = req.query;
	
	if(rev) {
		var rawContent = await curs.execute("select content, time from history where title = ? and namespace = ? and rev = ?", [doc.title, doc.namespace, rev]);
		var data = rawContent;
	} else {
		rev = null;
		var rawContent = await curs.execute("select content from documents where title = ? and namespace = ?", [doc.title, doc.namespace]);
	}
	if(rev && !rawContent.length) return await showError(req, 'revision_not_found');

	var content = {};
	var httpstat = 200;
	var viewname = 'wiki';
	var error = null;
	var lastedit = undefined;
	
	const aclmsg = await getacl(req, doc.title, doc.namespace, 'read', 1);
	if(aclmsg) {
		if(!ver('4.5.7')) return await showError(req, 'permission_read');
		httpstat = 403;
		error = err('error', { code: 'permission_read', msg: aclmsg });
		content.content = '<h2>' + aclmsg + '</h2>';
	} else if(!rawContent.length) {
		viewname = 'notfound';
		httpstat = 404;
		var data = await curs.execute("select flags, rev, time, changes, log, iserq, erqnum, advance, ismember, username from history \
						where title = ? and namespace = ? order by cast(rev as integer) desc limit 3",
						[doc.title, doc.namespace]);
		
		content.history = [];
		
		if(data.length) {
			for(var row of data) {
				var historylog = {
					date: row.time,
					rev: row.rev,
					logtype: row.advance,
					count: row.changes,
					target_rev: row.flags.split('\n')[0],
					log: row.log,
				};
				historylog[row.ismember] = row.username;
				content.history.push(historylog);
			}
		}
	} else {
		if(rawContent[0].content.startsWith('#redirect ')) {
			const nd = rawContent[0].content.split('\n')[0].replace('#redirect ', '').split('#');
			const ntitle = nd[0];
			
			if(req.query['noredirect'] != '1' && !req.query['from']) {
				return await render(req, totitle(doc.title, doc.namespace) + '', {
					redirect: ntitle,
				}, error, 'w', 302);
			} else {
				content = '#redirect <a class=wiki-link-internal href="' + encodeURIComponent(ntitle) + (nd[1] ? ('#' + nd[1]) : '') + '">' + html.escape(ntitle) + '</a>';
			}
		} else content = await markdown(req, rawContent[0].content, 0, doc + '');
		
		if(rev && ver('4.20.0') && hostconfig.namuwiki_exclusive) content = alertBalloon('<strong>[주의!]</strong> 문서의 이전 버전(' + generateTime(toDate(data[0].time), timeFormat) + '에 수정)을 보고 있습니다. <a href="/w/' + encodeURIComponent(doc + '') + '">최신 버전으로 이동</a>', 'danger', true, '', 1) + content;
		if(req.query['from']) {
			content = alertBalloon('<a href="' + encodeURIComponent(req.query['from']) + '?noredirect=1" class=document>' + html.escape(req.query['from']) + '</a>에서 넘어옴', 'info', false) + content;
		}
		
		var data = await curs.execute("select time from history where title = ? and namespace = ? order by cast(rev as integer) desc limit 1", [doc.title, doc.namespace]);
		lastedit = Number(data[0].time);
	}
	
	const dpg = await curs.execute("select tnum, time from threads where namespace = ? and title = ? and status = 'normal' and cast(time as integer) >= ?", [doc.namespace, doc.title, getTime() - 86400000]);
	
	var star_count = 0, starred = false;
	if(rawContent.length) {
		var dbdata = await curs.execute("select title, namespace from stars where username = ? and title = ? and namespace = ?", [ip_check(req), doc.title, doc.namespace]);
		if(dbdata.length) starred = true;
		var dd = await curs.execute("select count(title) from stars where title = ? and namespace = ?", [doc.title, doc.namespace]);
		star_count = dd[0]['count(title)'];
	}
	
	return(await render(req, totitle(doc.title, doc.namespace) + (rev ? (' (r' + rev + ' 판)') : ''), {
		content,
		star_count: ver('4.9.0') && rawContent.length ? star_count : undefined,
		starred: ver('4.9.0') && rawContent.length ? starred : undefined,
		date: Math.floor(lastedit / 1000),
		document: doc,
		rev,
		user: doc.namespace == '사용자' ? true : false,
		discuss_progress: dpg.length ? true : false,
	}, error, viewname, httpstat));
});