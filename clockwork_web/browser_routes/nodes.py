from pprint import pprint
import re
import os
import json
import requests
import time
import logging
from collections import defaultdict


# Use of "Markup" described there to avoid Flask escaping it when passing to a template.
# https://stackoverflow.com/questions/3206344/passing-html-to-template-using-flask-jinja2

from flask import Flask, Response, url_for, request, redirect, make_response, Markup
from flask import request, send_file
from flask import jsonify
from werkzeug.utils import secure_filename
from werkzeug.wsgi import FileWrapper

# https://flask.palletsprojects.com/en/1.1.x/appcontext/
from flask import g

from flask_login import (
    current_user,
    login_required,
)
from flask_babel import gettext

# As described on
#   https://stackoverflow.com/questions/15231359/split-python-flask-app-into-multiple-files
# this is what allows the factorization into many files.
from flask import Blueprint

flask_api = Blueprint("nodes", __name__)


from clockwork_web.core.clusters_helper import get_all_clusters
from clockwork_web.core.nodes_helper import get_nodes
from clockwork_web.core.jobs_helper import (
    get_filter_cluster_name,
    combine_all_mongodb_filters,
)
from clockwork_web.core.nodes_helper import (
    get_filter_node_name,
    strip_artificial_fields_from_node,
)
from clockwork_web.core.pagination_helper import get_pagination_values
from clockwork_web.core.users_helper import render_template_with_user_settings
from clockwork_web.core.utils import get_custom_array_from_request_args

# Note that flask_api.route('/') will lead to a redirection with "/nodes", and pytest might not like that.


@flask_api.route("/list")
@login_required
def route_list():
    """
    Can take optional args "cluster_name" and "node_name",
    where "name" refers to the host name.
    "page_num" is optional and used for the pagination: it is a positive integer
    presenting the number of the current page
    "nbr_items_per_page" is optional and used for the pagination: it is a
    positive integer presenting the number of items to display per page

    .. :quickref: list all Slurm nodes as formatted html
    """
    logging.info(
        f"clockwork browser route: /nodes/list - current_user={current_user.mila_email_username}"
    )

    # Initialize the request arguments (it is further transferred to the HTML)
    previous_request_args = {}

    # Retrieve the pagination parameters
    pagination_page_num = request.args.get("page_num", type=int, default="1")
    pagination_nbr_items_per_page = request.args.get("nbr_items_per_page", type=int)
    previous_request_args["page_num"] = pagination_page_num
    if pagination_nbr_items_per_page:
        previous_request_args["nbr_items_per_page"] = pagination_nbr_items_per_page

    # Use the pagination helper to define the number of element to skip, and the number of elements to display
    (nbr_skipped_items, nbr_items_to_display) = get_pagination_values(
        current_user.mila_email_username,
        pagination_page_num,
        pagination_nbr_items_per_page,
    )

    # Retrieve the arguments given in order to search the expected nodes
    node_name = request.args.get("node_name", None)
    if node_name:
        previous_request_args["node_name"] = node_name

    requested_cluster_names = get_custom_array_from_request_args(
        request.args.get("cluster_name")
    )

    # Limit the cluster options to the clusters the user can access
    user_clusters = (
        current_user.get_available_clusters()
    )  # Retrieve the clusters the user can access

    cluster_names = [
        cluster for cluster in requested_cluster_names if cluster in user_clusters
    ]

    if len(cluster_names) < 1:
        # If no cluster has been requested, then all clusters have been requested
        # (a filter related to which clusters are available to the current user
        #  is then applied)
        cluster_names = current_user.get_available_clusters()

    previous_request_args["cluster_name"] = cluster_names

    # Define the filters to select the nodes
    filters = set_up_cluster_names_and_node_name_filters(cluster_names, node_name)

    # Combine the filters
    filter = combine_all_mongodb_filters(*filters)

    # Retrieve the nodes, by applying the filters and the pagination,
    # and the number of nodes corresponding to the filter without the pagination
    (LD_nodes, nbr_total_nodes) = get_nodes(
        filter,
        nbr_skipped_items=nbr_skipped_items,
        nbr_items_to_display=nbr_items_to_display,
        want_count=True,  # We want the result as a tuple (nodes_list, nodes_count)
    )

    # Format the nodes (by withdrawing the "_id" element of each node)
    LD_nodes = [strip_artificial_fields_from_node(D_node) for D_node in LD_nodes]

    # Display the HTML page
    return render_template_with_user_settings(
        "nodes.html",
        LD_nodes=LD_nodes,
        mila_email_username=current_user.mila_email_username,
        page_num=pagination_page_num,
        nbr_total_nodes=nbr_total_nodes,
        previous_request_args=previous_request_args,
    )


@flask_api.route("/one")
@login_required
def route_one():
    """
    Same as /list but we expect to have only a single value,
    and we render the template "single_node.html" instead of "nodes.html".

    .. :quickref: list one Slurm node as formatted html
    """
    logging.info(
        f"clockwork browser route: /nodes/one - current_user={current_user.mila_email_username}"
    )

    # Initialize the request arguments (it is further transferred to the expected HTML)
    previous_request_args = {}

    # Retrieve the arguments given in order to search the node
    node_name = request.args.get("node_name", None)
    if node_name:
        previous_request_args["node_name"] = node_name

    cluster_name = request.args.get("cluster_name", None)
    if cluster_name:
        previous_request_args["cluster_name"] = cluster_name

    # Define the filters to select the nodes
    filters = set_up_cluster_names_and_node_name_filters([cluster_name], node_name)

    # Combine the filters
    filter = combine_all_mongodb_filters(*filters)

    # Retrieve a list of nodes according to the filter (and hoping the
    # list contains only one element)
    (LD_nodes, _) = get_nodes(filter)

    # Return an error if 0 or more than 1 node(s) are retrieved
    if len(LD_nodes) == 0:
        return (
            render_template_with_user_settings(
                "error.html",
                error_msg=f"Node not found",
                previous_request_args=previous_request_args,
            ),
            404,  # Not Found
        )
    elif len(LD_nodes) > 1:
        return (
            render_template_with_user_settings(
                "error.html",
                error_msg=f"Found more than one matching node",
                previous_request_args=previous_request_args,
            ),
            400,  # Bad Request
        )

    # Strip the _id element from the node
    D_node = strip_artificial_fields_from_node(LD_nodes[0])  # the one and only

    # Note that D_node contains the "slurm" field (which we want to list)
    # and the "cw" field (which we will omit in the front-end for now).
    D_node_slurm = D_node.get("slurm", {})

    # need to format it as list of tuples for the template (unless I'm mistaken)
    LP_single_node_slurm = list(sorted(D_node_slurm.items(), key=lambda e: e[0]))

    node_name = D_node_slurm.get("name", gettext("(missing node name)"))
    return render_template_with_user_settings(
        "single_node.html",
        LP_single_node_slurm=LP_single_node_slurm,
        node_name=node_name,
        mila_email_username=current_user.mila_email_username,
        previous_request_args=previous_request_args,
    )


def set_up_cluster_names_and_node_name_filters(cluster_names=[], node_name=None):
    """
    Set up the filters associated to the cluster_name and the node_name
    to retrieve one or more nodes.

    Params:
    - node_name          The name of the node we are looking for. If None,
                         the research will be done only according to the cluster
    - cluster_names      List of the names of the clusters on which we are looking
                         for the node(s). If None, we are looking on each
                         cluster the user can access

    Returns:
        A list containing the filters. The name filter is the first one, the cluster
        filter is the second one. If one of the filter is None, an error occurred
        when setting up this filter.
    """
    # ... node_name filter
    f0 = get_filter_node_name(node_name)
    # ... cluster_name filter
    user_clusters = (
        current_user.get_available_clusters()
    )  # Retrieve the clusters available to the current user

    cluster_names = [
        cluster_name for cluster_name in cluster_names if cluster_name in user_clusters
    ]
    if len(cluster_names) < 1:
        # If no cluster has been provided, return only the nodes on the clusters available
        # for the user
        cluster_names = user_clusters

    f1 = {"slurm.cluster_name": {"$in": user_clusters}}

    return [f0, f1]
