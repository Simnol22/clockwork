"use strict";

/*
    Two main functions :
        // async call, fetches data from server
        launch_refresh_all_data()

        // uses global variables, does not fetch data
        refresh_display(display_filter)
*/


//date stuff
var TimeAgo = (function() {
var self = {};

  // Public Methods
self.locales = {
    prefix: '',
    sufix:  'ago',

    seconds: 'less than a minute',
    minute:  'about a minute',
    minutes: '%d minutes',
    hour:    'about an hour',
    hours:   'about %d hours',
    day:     'a day',
    days:    '%d days',
    month:   'about a month',
    months:  '%d months',
    year:    'about a year',
    years:   '%d years'
};

self.inWords = function(timeAgo) {
    var seconds = Math.floor((new Date() - parseInt(timeAgo)) / 1000),
        separator = this.locales.separator || ' ',
        words = this.locales.prefix + separator,
        interval = 0,
        intervals = {
          year:   seconds / 31536000,
          month:  seconds / 2592000,
          day:    seconds / 86400,
          hour:   seconds / 3600,
          minute: seconds / 60
    };

    var distance = this.locales.seconds;

    for (var key in intervals) {
        interval = Math.floor(intervals[key]);

        if (interval > 1) {
            distance = this.locales[key + 's'];
            break;
        } else if (interval === 1) {
            distance = this.locales[key];
            break;
        }
    }

        distance = distance.replace(/%d/i, interval);
        words += distance + separator + this.locales.sufix;

        return words.trim();
    };

    return self;
}());


const job_state_to_aggregated = {
    "BOOT_FAIL": "FAILED",
    "CANCELLED": "FAILED",
    "COMPLETED": "COMPLETED",
    "CONFIGURING": "PENDING",
    "COMPLETING": "RUNNING",
    "DEADLINE": "FAILED",
    "FAILED": "FAILED",
    "NODE_FAIL": "FAILED",
    "OUT_OF_MEMORY": "FAILED",
    "PENDING": "PENDING",
    "PREEMPTED": "FAILED",
    "RUNNING": "RUNNING",
    "RESV_DEL_HOLD": "PENDING",
    "REQUEUE_FED": "PENDING",
    "REQUEUE_HOLD": "PENDING",
    "REQUEUED": "PENDING",
    "RESIZING": "PENDING",
    "REVOKED": "FAILED",
    "SIGNALING": "RUNNING",
    "SPECIAL_EXIT": "FAILED",
    "STAGE_OUT": "RUNNING",
    "STOPPED": "FAILED",
    "SUSPENDED": "FAILED",
    "TIMEOUT": "FAILED",
};


// We set up a request to retrieve the jobs list as JSON
const refresh_endpoint = "/jobs/search?want_json=True&want_count=True"

// This id is used to identify the table to populate in the associated HTML file
const id_of_table_to_populate = "dashboard_table" // hardcoded into jobs.html also

/*  The point of having those two global variables
    is that you can externally call `refresh_display(display_filter)`.
    It's not nice to deal with global variables, but the alternative
    is that we export more of the arbitrary stuff to the outside.
*/

var latest_response_contents; // Stores the content of the latest response received

function count_jobs(response_contents) {
    const categories = [
        ["COMPLETED", "completed"],
        ["RUNNING", "running"],
        ["PENDING", "pending"],
        ["FAILED", "stalled"],
    ];

    for (const [category, element_name] of categories) {
        const div = document.getElementById("dashboard_" + element_name);
        let counter = 0;
        for (const D_job of response_contents) {
            const job_state = D_job["slurm"]["job_state"];
            if (job_state_to_aggregated[job_state] === category) {
                counter++;
            }
        }
        div.textContent = counter;
    }
}


function format_date(timestamp) {
    /*
        Format a timestamp in order to display it in the a format according to the
        user's web settings.
    */
    let date_to_format = new Date(timestamp*1000); // The timestamp should be in milliseconds, not in seconds

    // Date
    // As word
    // This is donc directly when creating the jobs list

    // As timestamp
    if ("date_format" in web_settings && web_settings["date_format"] == "unix_timestamp"){
        return timestamp.toString();
    }
    else {
        // Format each element
        let formatted_date, formatted_time;

        const year = date_to_format.getFullYear();
        const month = (date_to_format.getMonth()+1).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false}); // Months are represented by indices from 0 to 11. Thus, 1 is added to the month. Moreover, this use of 'toLocaleString' is used to display each month with two digits (even the months from 1 to 9)
        const day = date_to_format.getDate().toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false}); // This use of 'toLocaleString' is used to display each day with two digits (even the days from 1 to 9)

        // As MM/DD/YYYY
        if ("date_format" in web_settings && web_settings["date_format"] == "MM/DD/YYYY"){
            formatted_date = `${month}/${day}/${year}`;
        }

        // As DD/MM/YYYY
        else if ("date_format" in web_settings && web_settings["date_format"] == "DD/MM/YYYY"){
            formatted_date = `${day}/${month}/${year}`;
        }

        // As YYYY/MM/DD (arbitrary default value)
        else {
            formatted_date = `${year}/${month}/${day}`;
        }

        // Hour
        // AM/PM
        if ("time_format" in web_settings && web_settings["time_format"] == "AM/PM"){
            formatted_time = date_to_format.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
        }
        // 24h
        else {
            formatted_time = date_to_format.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }); // hourCycle is set to h23 because otherwise, midnight is "24h" instead of "00h" on Chrome
        }

        return `${formatted_date} ${formatted_time}`;
    }
}

function check_web_settings_column_display(page_name, column_name){
    /*
        Check whether or not the web setting associated to the display of a job property
        as column on an array on a page (here "dashboard") is set. If it is set,
        check its boolean value.

        Such a web setting, if set, is accessible by calling web_settings[page_name][column_name].
        The different columns (ie jobs properties) for the dashboard page are now the following:
        ["clusters", "job_id", "job_name", "job_state", "start_time", "submit_time", "end_time", "links", "actions"]

        Parameters:
            page_name       The name of the page on which we should display or not the
                            job properties requested by the user in its preferences. For now,
                            the values "dashboard" or "jobs_list" are expected
            column_name     The column showing a specific job property, to display or not regarding
                            the preferences of the user.

        Returns:
            True if the web_setting is unset or True, False otherwise.
    */
            return !(("column_display" in web_settings) && (page_name in web_settings["column_display"]) && (column_name in web_settings["column_display"][page_name])) || web_settings["column_display"][page_name][column_name];
}

/**
 * Improved version of fetch() that accepts a timeout in milliseconds
 * into options.
 * Reference (2022/02/15): https://dmitripavlutin.com/timeout-fetch-request/
 * @param resource - first parameter for fetch() (url or Request object)
 * @param options - fetch() options. Accepts option `timeout` to specify
 * timeout in milliseconds. Default to 20000 ms (20 seconds).
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 20000 } = options;
    console.log(`Fetch with timeout ${timeout} ms`);

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

function launch_refresh_all_data(query_filter, display_filter) {
    /*
        We just clicked on "refresh", or maybe we have freshly loaded
        the page and need to create the table for the first time.

        // things that affect the data fetched
        query_filter = {
            "username": "all", // or specific username
            "time": 3600, // int, for number of seconds to go backwards
        }

        // things that we toggle in the interface
        display_filter = {
            "cluster_name": {
                "mila": true,
                "beluga": true,
                "cedar": true,
                "graham": true
            },
            "job_state": {
                "PENDING": true,
                "RUNNING": true,
                "COMPLETING": true,
                "COMPLETED": true,
                "OUT_OF_MEMORY": true,
                "TIMEOUT": true,
                "FAILED": true,
                "CANCELLED": true,
                "PREEMPTED": true,
            }
        }

        Keep in mind that any REST API call made here is done
        under the identity of the authenticated user so we don't need
        to worry about identification. The user cookie is passed automatically
        in the headers.
    */

    let url = refresh_endpoint;
    // If a user is specified, add its username to the request
    if (query_filter["username"].localeCompare("all") != 0) {
      url = url + "&username=" + query_filter["username"];
    }

    // Send the request, and retrieve the response
    const request = new Request(url,
        {   method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    fetchWithTimeout(request)
    .then(response => {
        if (response.status === 200) {
            return response.json();
        } else {
            throw new Error('Something went wrong on api server!');
        }
    })
    .then(response_contents => {
        latest_response_contents = response_contents;
        refresh_display(display_filter);

    }).catch(error => {
        console.error(error);
    });
}

function refresh_display(display_filter) {
    /*
        Clear and populate the jobs table with the latest response content,
        filtered by the "display filters" given as parameters.
    */
    const latest_filtered_response_contents = apply_filter(latest_response_contents["jobs"], display_filter);
    const alljobs_filtered = apply_filter(latest_response_contents["jobs"], display_filter);


    //for testing only - use a smaller number
    //nbr_items_per_page = 3;

    // The following lines are commented because we do not want to add pagination
    // on the dashboard for now.
    // const total_jobs = latest_response_contents["nbr_total_jobs"];
    //page_num = document.getElementById('page_num').value;
    //nbr_items_per_page = display_filter['num_per_page'];
    //nbr_pages = Math.ceil(total_jobs / nbr_items_per_page);

    vacate_table(); // idempotent if not table is present
    populate_table(latest_filtered_response_contents);

    //kaweb - attempt to count results
    count_jobs(alljobs_filtered);
}

/*
    Helpers:
        retrieve_username_from_email(email)
        vacate_table()
        populate_table(response_contents)
        apply_filter(response_contents, display_filter)
*/


function vacate_table() {
    // mix of
    //    https://stackoverflow.com/questions/14094697/how-to-create-new-div-dynamically-change-it-move-it-modify-it-in-every-way-po
    //    https://stackoverflow.com/questions/24775725/loop-through-childnodes

    let table = document.getElementById(id_of_table_to_populate);

    /*  Everyone says that this can cause problems with parsing the DOM again,
        but given how many removals we need to do, it seems like it's cheap
        comparatively to removing every one of the 1000 rows.

        They also say that it can leak memory if there are handlers in the elements
        removed, but I don't think we've put anything in particular there.
        We might need to do some profiling later, and revisit this.
    */
    table.innerHTML = "";
    /*
    [].forEach.call(table.children, function(child) {
        table.removeChild(child);
    });
    */
}

function apply_filter(response_contents, display_filter) {

    /*  Since `display_filter` has two dicts that contain (str, bool),
        this makes it very easy to check if, for example,
            when D_job["cluster_name"] is "mila"
            is display_filter["cluster_name"]["mila"] true ?
        We do it for "cluster_name" and "job_state".

        Note that "job_state" is one of 8 possible strings in UPPERCASE,
        and not the projection down to 4 states that we use for toggle switches.
    */

    return response_contents.filter( D_job => {
        return display_filter["cluster_name"][D_job["slurm"]["cluster_name"]] && display_filter["job_state"][D_job["slurm"]["job_state"]]
    });
    //return response_contents;
}

/**
 * Backup variable to store sortable settings if we can't store it in localStorage.
 * By default, we want to store sortable settings in Javascript localStorage, so that
 * settings are saved even if user closes web page or browser. But storing in localStorage
 * may fail, so we need to define a backup strategy, that will save settings just for
 * current opened page.
 * More info: https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem#exceptions
 */
let BACKUP_SORTABLE_STORAGE = null;

/**
 * Get sortable settings. Return an object with fields
 * `name` for column name (string), and `ascending` for sorting direction (integer),
 * either 1 (ascending) or -1 (descending).
 */
function getSortableState() {
    const data = window.localStorage.getItem('SORTABLE_STATE');
    if (data) {
        return JSON.parse(data);
    } else {
        return BACKUP_SORTABLE_STORAGE || {name: null, ascending: 0, defaultAscending: 0};
    }
}

/**
 * Store sortable settings.
 */
function setSortableState(sortableState) {
    try {
        window.localStorage.setItem('SORTABLE_STATE', JSON.stringify(sortableState));
    } catch (exception) {
        console.error(exception);
        BACKUP_SORTABLE_STORAGE = sortableState;
    }
}

/**
 * Event listener to listen clicks on table column header.
 * Capture click to infer sortable settings and store it.
 * @param event - click event (currently not used)
 * @param colName - column name
 * @param colIndex - column index in table (starting at 0)
 * @param table - table HTML element
 */
function onClickSortableColumn(event, colName, colIndex, table) {
    const sortableState = getSortableState();
    // Get default sorting direction from framework Sortable.
    // Default direction is descending for number, ascending for other types.
    const defaultSortDirection = Sortable.getColumnType(table, colIndex).defaultSortDirection;
    console.log(colName, defaultSortDirection);
    sortableState.defaultAscending = defaultSortDirection === 'descending' ? -1 : 1;
    if (sortableState.name === colName) {
        // If we are on same column, new direction is reverse from previous.
        sortableState.ascending = -sortableState.ascending;
    } else {
        // Otherwise, we got full new sortable settings.
        sortableState.name = colName;
        sortableState.ascending = sortableState.defaultAscending;
    }
    // Store inferred settings.
    setSortableState(sortableState);
    console.log(`Current sorting: ${colName}/${sortableState.ascending === 1 ? 'ascending' : 'descending'}`);
}


function populate_table(response_contents) {
    /*
        `response_contents` here is a list of dict with fields
            'slurm': {
                        'cluster_name': ... ,
                        'username': ... ,
                        'job_id': ... ,
                        'name': ... ,
                        ...
                    },
            'cw': {
                    ...
                  }


          For now, we mainly display the "slurm" informations of each job
            <td>{{e['cluster_name']}}</td>
            <td><a href="/jobs/one?job_id={{e['job_id']}}"> {{e['job_id']}} </a></td>
            <td>{{e.get('name', "")[:32]}}</td> <!-- truncate after 32 chars -->
            <td>{{e['job_state']}}</td>
            ...
    */
    // Initialize the name of the current page
    let page_name = "dashboard";

    let table = document.getElementById(id_of_table_to_populate);

    /* create the table header */
    let thead = document.createElement('thead');
    let tr = document.createElement('tr');
    let th;
    // We will find the column to sort using current sortable state.
    let thToSort;
    const currentSortableState = getSortableState();
    setSortableState({name: null, ascending: 0, defaultAscending: 0});
    // Clusters header
    if (check_web_settings_column_display(page_name, "clusters")) {
        th = document.createElement('th');
        th.innerHTML = "Cluster";
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'clusters', 0, table));
        if (currentSortableState.name === 'clusters') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // Job ID header
    if (check_web_settings_column_display(page_name, "job_id")) {
        th = document.createElement('th');
        th.innerHTML = "Job ID";
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'job_id', 1, table));
        if (currentSortableState.name === 'job_id') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // Job name header
    if (check_web_settings_column_display(page_name, "job_name")) {
        th = document.createElement('th');
        th.innerHTML = "Job name [:20]";
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'job_name', 2, table));
        if (currentSortableState.name === 'job_name') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // Job state header
    if (check_web_settings_column_display(page_name, "job_state")) {
        th = document.createElement('th');
        th.innerHTML = "Job state";
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'job_state', 3, table));
        if (currentSortableState.name === 'job_state') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // Submit time header
    if (check_web_settings_column_display(page_name, "submit_time")) {
        th = document.createElement('th');
        th.innerHTML = "Submit time";
        th.setAttribute("data-sortable-type", "numeric");
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'submit_time', 4, table));
        if (currentSortableState.name === 'submit_time') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // Start time header
    if (check_web_settings_column_display(page_name, "start_time")) {
        th = document.createElement('th');
        th.innerHTML = "Start time";
        th.setAttribute("data-sortable-type", "numeric");
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'start_time', 5, table));
        if (currentSortableState.name === 'start_time') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // End time header
    if (check_web_settings_column_display(page_name, "end_time")) {
        th = document.createElement('th');
        th.innerHTML = "End time";
        th.setAttribute("data-sortable-type", "numeric");
        th.addEventListener('click', (evt) => onClickSortableColumn(evt, 'end_time', 6, table));
        if (currentSortableState.name === 'end_time') {
            thToSort = th;
        }
        tr.appendChild(th);
    }
    // Links header
    if (check_web_settings_column_display(page_name, "links")) {
        th = document.createElement('th');
        th.innerHTML = "Links";
        th.setAttribute("data-sortable", "false");
        tr.appendChild(th);
    }
    // Actions header
    if (check_web_settings_column_display(page_name, "actions")) {
        th = document.createElement('th');
        th.innerHTML = "Actions";
        th.setAttribute("data-sortable", "false");
        tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);

    let tbody = document.createElement('tbody');
    /* then add the information for all the jobs */
    [].forEach.call(response_contents, function(D_job) {
        const D_job_slurm = D_job["slurm"];
        //kaweb - displaying the job state in lowercase to manipulate it in CSS
        const job_state = D_job_slurm["job_state"].toLowerCase();
        let tr = document.createElement('tr');

        // Clusters
        if (check_web_settings_column_display(page_name, "clusters")) {
            const td = document.createElement('td');
            if (D_job_slurm["cluster_name"]) {
                const a = document.createElement("a");
                a.setAttribute("href", "/clusters/one?cluster_name=" + D_job_slurm["cluster_name"]);
                a.innerHTML = D_job_slurm["cluster_name"];
                td.appendChild(a);
            }
            else {
                td.innerHTML = D_job_slurm["cluster_name"];
            }
            tr.appendChild(td);
        }
        // Job ID
        if (check_web_settings_column_display(page_name, "job_id")) {
            const td = document.createElement('td');
            td.innerHTML = ("<a href=\"" + "/jobs/one?job_id=" + D_job_slurm["job_id"] + "\">" + D_job_slurm["job_id"] + "</a>");
            tr.appendChild(td);
        }
        // Job name
        if (check_web_settings_column_display(page_name, "job_name")) {
            const td = document.createElement('td');
            td.innerHTML = (D_job_slurm["name"] ? D_job_slurm["name"] : "").substring(0, 20);
            tr.appendChild(td);  // truncated after 20 characters (you can change this magic number if you want)
        }
        // Job state
        if (check_web_settings_column_display(page_name, "job_state")) {
            //td = document.createElement('td'); td.innerHTML = D_job_slurm["job_state"]; tr.appendChild(td);
            //kaweb - using the job state as a shorthand to insert icons through CSS
            const td = document.createElement('td');
            td.className = "job_state";

            const formatted_job_state = job_state.replace(/_/g, " ");
            const aggregated_job_state = (job_state_to_aggregated[job_state.toUpperCase()] || "NONE").toLowerCase();

            td.innerHTML = ("<span class=\"status " + aggregated_job_state + "\">" + formatted_job_state + "</span>");
            tr.appendChild(td);
        }
        // Submit_time, start time and end_time of the jobs
        let job_times = ["submit_time", "start_time", "end_time"];
        for (var i=0; i<job_times.length; i++) {
            let job_time = job_times[i];
            if (check_web_settings_column_display(page_name, job_time)) {
                const td = document.createElement('td');
                if (D_job_slurm[job_time] == null) {
                    td.innerHTML = "";
                } else {
                    // If you want to display the time as "2021-07-06 22:19:46" for readability
                    // you need to set it up because this is going to be written as a unix timestamp.
                    // This might include injecting another field with a name
                    // such as "start_time_human_readable" or something like that, and using it here.

                    if ("date_format" in web_settings && web_settings["date_format"] == "words") {
                        td.innerHTML = TimeAgo.inWords(Date.now() - D_job_slurm[job_time]); // For a relative time
                    }
                    else {
                        td.innerHTML = format_date(D_job_slurm[job_time]); // For a human readable time or a timestamp
                    }
                }
                tr.appendChild(td);
            }
        }

        // Links
        if (check_web_settings_column_display(page_name, "links")) {
            const td = document.createElement('td');
            td.className = "links";

            let link0_innerHTML;
            // This link works only for Narval and Beluga. See CW-141.
            if ((D_job_slurm["cluster_name"] == "narval") || (D_job_slurm["cluster_name"] == "beluga")) {
                // https://portail.narval.calculquebec.ca/secure/jobstats/<username>/<jobid>
                let target_url = `https://portail.${D_job_slurm["cluster_name"]}.calculquebec.ca/secure/jobstats/${D_job_slurm["username"]}/${D_job_slurm["job_id"]}`
                link0_innerHTML = `<a href='${target_url}' data-bs-toggle='tooltip' data-bs-placement='right' title='this job on DRAC portal'><i class='fa-solid fa-file'></i></a>`
            } else {
                link0_innerHTML = ""
            }
            // This is just a placeholder for now.
            const link1_innerHTML = "<a href='' data-bs-toggle='tooltip' data-bs-placement='right' title='Link to another place'><i class='fa-solid fa-link-horizontal'></i></a>"
            td.innerHTML = link0_innerHTML + link1_innerHTML
            tr.appendChild(td);
        }

        // Actions
        if (check_web_settings_column_display(page_name, "actions")) {
            const td = document.createElement('td');
            td.className = "actions";
            td.innerHTML = (
                "<a href='' class='stop' data-bs-toggle='tooltip' data-bs-placement='right' title='Cancel job'><i class='fa-solid fa-xmark'></i></a>"
            );
            tr.appendChild(td);
        }

        tbody.appendChild(tr);

    });
    table.appendChild(tbody);
    // Activate sorting.
    if (table.getAttribute('data-sortable-initialized')) {
        table.setAttribute('data-sortable-initialized', "false");
    }
    console.log(`Init sorting for ${id_of_table_to_populate}`);
    Sortable.initTable(table);
    // Sort newly populated table using current sortable state.
    // To do sorting, we click on column.
    // If default sorting is ascending, we click once for ascending direction, twice for descending.
    // If default sorting is descending, we click once for descending direction, twice for ascending.
    if (thToSort) {
        console.log('click once');
        thToSort.click();
        if (currentSortableState.ascending !== currentSortableState.defaultAscending) {
            console.log('click twice');
            thToSort.click();
        }
    }

    /* some of that can be used for adding the href back in the code above
        let td0 = document.createElement('td');
            let url = "../../../joplin_live/arcanix/note/" + note_info["jid"];
            td0.innerHTML = "<a href=\"" + url + "\">" + note_info["title"] + "</a>";
            */
}


function retrieve_username_from_email(email) {
    /*
        Retrieve the first part of the email identifying a user.

        The format of an input email is:
        firstname.name@mila.quebec

        The expected result for this function is:
        firstname.name
        (or more generally the party before the @)
    */
    if (email !== null) {
        const parsed_email = email.split("@");
        return parsed_email[0];
    }
    else {
      return "";
    }
}
