from flask import Blueprint, request
from flask_login import current_user, login_required
import logging

flask_api = Blueprint("users", __name__)

from clockwork_web.core.users_helper import (
    get_users_one,
    render_template_with_user_settings,
)
from clockwork_web.core.clusters_helper import get_account_fields
from clockwork_web.core.users_helper import render_template_with_user_settings


@flask_api.route("/one")
@login_required
def route_one():
    """
    Takes "username" as a mandatory argument.

    Returns a page displaying the User information if a username is
    specified.
    Returns an error message otherwise. The potential returned error
    is:
        - 400 ("Bad Request") if the username is missing.

    .. :quickref: display the information of one user as formatted HTML
    """
    # Initialize the request arguments (it is further transferred to the HTML)

    logging.info(
        f"clockwork web route: /users/one - current_user={current_user.mila_email_username}"
    )

    previous_request_args = {}

    username = request.args.get("username", None)
    previous_request_args["username"] = username
    if username is None:
        return (
            render_template_with_user_settings(
                "error.html",
                error_msg=f"Missing argument username.",
                previous_request_args=previous_request_args,
            ),
            400,  # Bad Request
        )

    # Retrieve the user information
    D_user = get_users_one(username)

    # Retrieve the keys identifying the account for each cluster
    # The retrieved dictionary has the following format, for instance:
    # {
    #    "key_for_first_set_of_clusters": ["cluster_name_1", ..., "cluster_name_x"],
    #    ...,
    #    "key_for_nth_set_of_clusters": ["cluster_name_A", ..., "cluster_name_m"]
    # }
    D_account_fields = get_account_fields()

    if D_user is not None:
        return render_template_with_user_settings(
            "single_user.html",
            username=username,
            user=D_user,
            account_fields=D_account_fields,
            mila_email_username=current_user.mila_email_username,
            previous_request_args=previous_request_args,
        )
    else:
        return (
            render_template_with_user_settings(
                "error.html",
                error_msg=f"The requested user has not been found.",
                previous_request_args=previous_request_args,
            ),
            404,  # Not Found
        )
